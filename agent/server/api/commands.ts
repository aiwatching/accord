import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHubState } from '../hub-state.js';
import { getAccordDir, getServiceNames, getInboxPath } from '../config.js';
import { scanInboxes, scanArchives } from '../scanner.js';
import { executeCommand } from '../commands.js';
import { eventBus } from '../event-bus.js';
import { logger } from '../logger.js';
import { generatePlan } from '../planner.js';

interface ExecBody {
  command: string;
}

interface ExecResult {
  command: string;
  output: string;
  success: boolean;
  timestamp: string;
}

const HELP_TEXT = `## Available Commands

| Command | Description |
|---------|-------------|
| **status** | Show contract counts, inbox items, archived requests |
| **scan** | Validate all contracts |
| **check-inbox** | List all pending inbox items |
| **validate** | Validate all request files |
| **sync** | Trigger an immediate scheduler sync cycle |
| **services** | List all configured services |
| **requests** | List all requests (use \`requests --status pending\` to filter) |
| **send <service> <message>** | Create a new request in a service's inbox |
| **help** | Show this help text |`;

export function registerCommandRoutes(app: FastifyInstance): void {
  app.post<{ Body: ExecBody }>('/api/commands/execute', async (req, reply) => {
    const raw = (req.body.command ?? '').trim();
    if (!raw) {
      return reply.status(400).send({ error: 'command is required' });
    }

    const parts = raw.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    const timestamp = new Date().toISOString();

    try {
      const output = await runCommand(cmd, args);
      return { command: raw, output, success: true, timestamp } satisfies ExecResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { command: raw, output: `ERROR: ${message}`, success: false, timestamp } satisfies ExecResult;
    }
  });

  // GET /api/logs — list session log files
  app.get('/api/logs', async () => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const sessionsDir = path.join(accordDir, 'comms', 'sessions');

    if (!fs.existsSync(sessionsDir)) {
      return [];
    }

    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.log'));
    const result = files.map(f => {
      const filePath = path.join(sessionsDir, f);
      const stat = fs.statSync(filePath);
      const requestId = f.replace(/\.log$/, '');
      // Read first line to extract service name from header
      const firstLine = fs.readFileSync(filePath, 'utf-8').split('\n')[0] ?? '';
      const match = firstLine.match(/--- .+? \| (.+?) \|/);
      const service = match ? match[1] : 'unknown';
      return { requestId, service, size: stat.size, modified: stat.mtime.toISOString() };
    });

    result.sort((a, b) => b.modified.localeCompare(a.modified));
    return result;
  });

  // GET /api/logs/:requestId — read a log file
  app.get<{ Params: { requestId: string } }>('/api/logs/:requestId', async (req, reply) => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const logFile = path.join(accordDir, 'comms', 'sessions', `${req.params.requestId}.log`);

    if (!fs.existsSync(logFile)) {
      return reply.status(404).send({ error: 'Log not found' });
    }

    const content = fs.readFileSync(logFile, 'utf-8');
    return { requestId: req.params.requestId, content };
  });

  // POST /api/session/send — direct orchestrator session interaction
  // Invokes the AI agent on the hub directory, streams output via WebSocket,
  // and maintains session continuity across messages.
  // When planner is enabled, generates a plan first and waits for approval.
  let sessionBusy = false;

  // Pending plan state (for two-phase planner flow)
  let pendingPlan: {
    plan: string;
    userMessage: string;
    timeoutHandle: ReturnType<typeof setTimeout>;
  } | null = null;

  /** Execute the orchestrator session (shared by direct and post-plan flows). */
  async function executeOrchestratorSession(message: string, approvedPlan?: string) {
    const { hubDir, config, dispatcherConfig, dispatcher } = getHubState();
    const adapter = dispatcher.getAdapter();
    const sessionManager = dispatcher.getSessionManager();
    const accordDir = getAccordDir(hubDir, config);

    const existing = adapter.supportsResume
      ? sessionManager.getSession('orchestrator')
      : undefined;
    const resumeId = existing?.sessionId;

    const startTime = Date.now();
    let streamIndex = 0;

    const sessionsDir = path.join(accordDir, 'comms', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const logFile = path.join(sessionsDir, 'orchestrator-session.log');
    fs.appendFileSync(logFile, `--- orchestrator | orchestrator | ${new Date().toISOString()} ---\n[YOU] ${message}\n`);

    eventBus.emit('session:start', {
      service: 'orchestrator',
      message: message.slice(0, 200),
    });

    const serviceNames = getServiceNames(config);
    const orchestratorPrompt = buildOrchestratorPrompt(message, serviceNames, accordDir, approvedPlan);

    try {
      const result = await adapter.invoke({
        prompt: orchestratorPrompt,
        cwd: hubDir,
        resumeSessionId: resumeId,
        timeout: dispatcherConfig.request_timeout,
        model: dispatcherConfig.model,
        maxTurns: 50,
        maxBudgetUsd: dispatcherConfig.max_budget_usd,
        onOutput: (chunk: string) => {
          fs.appendFileSync(logFile, chunk);
          eventBus.emit('session:output', {
            service: 'orchestrator',
            chunk,
            streamIndex: streamIndex++,
          });
        },
      });

      if (result.sessionId) {
        sessionManager.updateSession('orchestrator', result.sessionId);
        sessionManager.saveToDisk(accordDir);
      }

      const durationMs = Date.now() - startTime;
      fs.appendFileSync(logFile, `\n--- completed | ${durationMs}ms ---\n`);

      eventBus.emit('session:complete', {
        service: 'orchestrator',
        durationMs,
        costUsd: result.costUsd,
        numTurns: result.numTurns,
      });

      return {
        success: true,
        durationMs,
        costUsd: result.costUsd,
        numTurns: result.numTurns,
        sessionId: result.sessionId,
      };
    } catch (err) {
      const error = String(err);
      logger.error(`[session] Orchestrator error: ${error}`);
      fs.appendFileSync(logFile, `\n--- failed | ${error} ---\n`);

      eventBus.emit('session:error', {
        service: 'orchestrator',
        error,
      });

      throw err;
    } finally {
      sessionBusy = false;
    }
  }

  app.post<{ Body: { message: string } }>('/api/session/send', async (req, reply) => {
    const message = (req.body.message ?? '').trim();
    if (!message) {
      return reply.status(400).send({ error: 'message is required' });
    }

    if (sessionBusy) {
      return reply.status(409).send({ error: 'Orchestrator session is busy. Wait for the current message to complete.' });
    }

    sessionBusy = true;
    logger.info(`[session] Orchestrator message: ${message.slice(0, 80)}...`);

    const { dispatcherConfig, config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const serviceNames = getServiceNames(config);

    // If planner is disabled, execute directly
    if (!dispatcherConfig.planner_enabled) {
      try {
        const result = await executeOrchestratorSession(message);
        return result;
      } catch (err) {
        return reply.status(500).send({
          success: false,
          error: String(err),
        });
      }
    }

    // Planner enabled — generate plan first
    eventBus.emit('session:plan-generating', {
      service: 'orchestrator',
      message: message.slice(0, 200),
    });

    let streamIndex = 0;

    try {
      const planResult = await generatePlan({
        userMessage: message,
        serviceNames,
        accordDir,
        model: dispatcherConfig.planner_model,
        onOutput: (chunk: string) => {
          eventBus.emit('session:output', {
            service: 'orchestrator',
            chunk,
            streamIndex: streamIndex++,
          });
        },
      });

      // Store pending plan and start timeout
      const timeoutMs = (dispatcherConfig.planner_timeout ?? 300) * 1000;
      const timeoutHandle = setTimeout(() => {
        if (pendingPlan) {
          pendingPlan = null;
          sessionBusy = false;
          eventBus.emit('session:plan-timeout', { service: 'orchestrator' });
          logger.info('[session] Plan approval timed out');
        }
      }, timeoutMs);

      pendingPlan = { plan: planResult.plan, userMessage: message, timeoutHandle };

      eventBus.emit('session:plan-ready', {
        service: 'orchestrator',
        plan: planResult.plan,
        costUsd: planResult.costUsd,
      });

      return { planReady: true, plan: planResult.plan, costUsd: planResult.costUsd };
    } catch (err) {
      sessionBusy = false;
      const error = String(err);
      logger.error(`[session] Planner error: ${error}`);
      eventBus.emit('session:error', { service: 'orchestrator', error });
      return reply.status(500).send({ success: false, error });
    }
  });

  // POST /api/session/approve-plan — approve, edit, or cancel a pending plan
  app.post<{ Body: { action: 'approve' | 'cancel'; editedPlan?: string } }>(
    '/api/session/approve-plan',
    async (req, reply) => {
      const { action, editedPlan } = req.body;

      if (!pendingPlan) {
        return reply.status(404).send({ error: 'No pending plan to approve' });
      }

      if (action === 'cancel') {
        clearTimeout(pendingPlan.timeoutHandle);
        pendingPlan = null;
        sessionBusy = false;
        eventBus.emit('session:plan-canceled', { service: 'orchestrator' });
        logger.info('[session] Plan canceled by user');
        return { success: true, action: 'canceled' };
      }

      // action === 'approve'
      const plan = editedPlan ?? pendingPlan.plan;
      const userMessage = pendingPlan.userMessage;
      clearTimeout(pendingPlan.timeoutHandle);
      pendingPlan = null;

      logger.info('[session] Plan approved, executing orchestrator');

      try {
        const result = await executeOrchestratorSession(userMessage, plan);
        return result;
      } catch (err) {
        return reply.status(500).send({
          success: false,
          error: String(err),
        });
      }
    },
  );
}

async function runCommand(cmd: string, args: string[]): Promise<string> {
  const { config, hubDir, scheduler } = getHubState();
  const accordDir = getAccordDir(hubDir, config);

  switch (cmd) {
    case 'status':
    case 'scan':
    case 'check-inbox':
    case 'validate':
      return executeCommand(cmd, hubDir, accordDir);

    case 'sync': {
      const processed = await scheduler.triggerNow();
      return `## Sync Complete\n\nScheduler tick triggered. **${processed}** request(s) processed.`;
    }

    case 'services':
      return formatServices(accordDir);

    case 'requests':
      return formatRequests(accordDir, args);

    case 'send':
      return handleSend(accordDir, args);

    case 'help':
      return HELP_TEXT;

    default:
      return `Unknown command: **${cmd}**\n\nType \`help\` for available commands.`;
  }
}

function formatServices(accordDir: string): string {
  const { config, hubDir, dispatcher } = getHubState();
  const allRequests = scanInboxes(accordDir, config, hubDir);
  const services = config.services;

  const lines: string[] = [
    '## Services',
    '',
    '| Name | Type | Status | Pending |',
    '|------|------|--------|---------|',
  ];

  for (const svc of services) {
    const pending = allRequests.filter(
      r => r.serviceName === svc.name && (r.frontmatter.status === 'pending' || r.frontmatter.status === 'approved')
    ).length;
    const type = svc.type ?? 'service';
    const status = pending > 0 ? 'pending' : 'idle';
    lines.push(`| ${svc.name} | ${type} | ${status} | ${pending} |`);
  }

  return lines.join('\n');
}

function formatRequests(accordDir: string, args: string[]): string {
  const { config, hubDir } = getHubState();
  let requests = scanInboxes(accordDir, config, hubDir);
  requests.push(...scanArchives(accordDir, config, hubDir));

  // Parse --status filter
  const statusIdx = args.indexOf('--status');
  if (statusIdx !== -1 && args[statusIdx + 1]) {
    const filterStatus = args[statusIdx + 1];
    requests = requests.filter(r => r.frontmatter.status === filterStatus);
  }

  if (requests.length === 0) {
    return '## Requests\n\nNo requests found.';
  }

  const lines: string[] = [
    '## Requests',
    '',
    '| ID | Service | Status | Priority | Type |',
    '|----|---------|--------|----------|------|',
  ];

  for (const r of requests) {
    lines.push(`| ${r.frontmatter.id} | ${r.serviceName} | ${r.frontmatter.status} | ${r.frontmatter.priority} | ${r.frontmatter.type} |`);
  }

  return lines.join('\n');
}

function handleSend(accordDir: string, args: string[]): string {
  if (args.length === 0) {
    return 'Usage: `send [service] <message>`\n\nExample: `send device-manager fix the authentication bug`\n\nIf no service is specified, defaults to orchestrator.';
  }

  const { config } = getHubState();
  const serviceNames = getServiceNames(config);

  // If first arg is a known service, use it; otherwise default to orchestrator
  let service: string;
  let message: string;
  if (serviceNames.includes(args[0])) {
    service = args[0];
    message = args.slice(1).join(' ');
    if (!message) {
      return 'Usage: `send [service] <message>`\n\nMessage is required.';
    }
  } else {
    service = 'orchestrator';
    message = args.join(' ');
  }

  if (!serviceNames.includes(service)) {
    return `Unknown service: **${service}**\n\nAvailable services: ${serviceNames.join(', ')}`;
  }

  const inboxPath = getInboxPath(accordDir, service);
  fs.mkdirSync(inboxPath, { recursive: true });

  const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const content = `---
id: ${id}
from: console
to: ${service}
scope: external
type: other
priority: medium
status: pending
created: ${now}
updated: ${now}
---

${message}
`;

  const filePath = path.join(inboxPath, `${id}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
  logger.info(`Console: created request ${id} for ${service}`);

  return `Request created: **${id}**\n\n- **To**: ${service}\n- **Message**: ${message}\n- **File**: ${path.basename(filePath)}`;
}

// ── Orchestrator prompt builder ─────────────────────────────────────────────

function buildOrchestratorPrompt(userMessage: string, serviceNames: string[], accordDir: string, approvedPlan?: string): string {
  // Read the request template if available
  const templatePath = path.join(accordDir, 'comms', 'TEMPLATE.md');
  const hasTemplate = fs.existsSync(templatePath);

  const planSection = approvedPlan
    ? `\n## Approved Execution Plan

Follow this plan closely:

${approvedPlan}
`
    : '';

  return `## CRITICAL ROLE CONSTRAINT

You are the **orchestrator**. You MUST follow these rules absolutely:

1. **NEVER write application code** — no models, controllers, services, components, APIs, or any implementation code.
2. **NEVER create or modify files outside the hub repo** — you only manage protocol files in this hub directory.
3. Your ONLY job is to **decompose tasks into requests** and **dispatch them to services** via the Accord protocol.
4. For each sub-task, create a request file in the target service's inbox: \`comms/inbox/{service}/req-{id}.md\`
5. Use the request template at \`comms/TEMPLATE.md\` for the correct format.${hasTemplate ? '' : ' If template is missing, use standard frontmatter with id, from, to, scope, type, priority, status, created, updated fields.'}

## Available Services

${serviceNames.map(s => `- ${s}`).join('\n')}
${planSection}
## What You Must Do

When the user describes a feature or task:
1. **Analyze** which services need to be involved
2. **Decompose** into concrete, actionable requests (one per service)
3. **Create request files** in each service's inbox with clear instructions
4. **Commit and push** so the daemon can dispatch workers to process them

## User Message

${userMessage}`;
}
