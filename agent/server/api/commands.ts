import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHubState, triggerDispatch } from '../hub-state.js';
import { getAccordDir, getServiceNames, getInboxPath, loadRegistryYaml } from '../config.js';
import { scanInboxes, scanArchives } from '../scanner.js';
import { executeCommand } from '../commands.js';
import { eventBus } from '../event-bus.js';
import { logger } from '../logger.js';
import { generatePlan } from '../planner.js';
import type { StreamEvent } from '../adapters/adapter.js';

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
| **sync** | Show sync status (A2A mode — no polling) |
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

  // GET /api/logs/:requestId — read a log file (with fallback to request content + history)
  app.get<{ Params: { requestId: string } }>('/api/logs/:requestId', async (req, reply) => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const requestId = req.params.requestId;
    const logFile = path.join(accordDir, 'comms', 'sessions', `${requestId}.log`);

    // Primary: session log file
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf-8');
      return { requestId, content };
    }

    // Fallback: synthesize from request file + history
    const allRequests = scanInboxes(accordDir, config, hubDir);
    allRequests.push(...scanArchives(accordDir, config, hubDir));
    const found = allRequests.find(r => r.frontmatter.id === requestId);

    // Collect history entries for this request
    const historyLines = readHistoryForRequest(accordDir, requestId);

    if (!found && historyLines.length === 0) {
      return reply.status(404).send({ error: 'Log not found' });
    }

    // Build a synthetic log from available data
    const parts: string[] = [];
    if (found) {
      const fm = found.frontmatter;
      parts.push(`--- request details ---`);
      parts.push(`ID:       ${fm.id}`);
      parts.push(`From:     ${fm.from}`);
      parts.push(`To:       ${fm.to}`);
      parts.push(`Type:     ${fm.type}`);
      parts.push(`Status:   ${fm.status}`);
      parts.push(`Priority: ${fm.priority}`);
      parts.push(`Created:  ${fm.created}`);
      parts.push(`Updated:  ${fm.updated}`);
      if (fm.directive) parts.push(`Directive: ${fm.directive}`);
      if (fm.attempts) parts.push(`Attempts: ${fm.attempts}`);
      parts.push('');
      parts.push('--- request body ---');
      parts.push(found.body || '(empty)');
      parts.push('');
    }
    if (historyLines.length > 0) {
      parts.push('--- history ---');
      parts.push(...historyLines);
    }
    if (parts.length === 0) {
      parts.push('(No session log or history available for this request)');
    }

    return { requestId, content: parts.join('\n') };
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
        onOutput: (event: StreamEvent) => {
          // Format event for log file
          let logText: string;
          switch (event.type) {
            case 'text': logText = event.text; break;
            case 'tool_use': logText = `\n[${event.tool}] ${event.input}\n`; break;
            case 'tool_result': logText = `${event.output}\n`; break;
            case 'thinking': logText = `[thinking] ${event.text.slice(0, 500)}...\n`; break;
            case 'status': logText = `[status] ${event.text}\n`; break;
            default: logText = JSON.stringify(event) + '\n';
          }
          fs.appendFileSync(logFile, logText);
          eventBus.emit('session:output', {
            service: 'orchestrator',
            chunk: logText,
            event,
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
  const { config, hubDir } = getHubState();
  const accordDir = getAccordDir(hubDir, config);

  switch (cmd) {
    case 'status':
    case 'scan':
    case 'check-inbox':
    case 'validate':
      return executeCommand(cmd, hubDir, accordDir);

    case 'sync':
      return `## Sync\n\nA2A mode: requests are dispatched via A2A push. No polling scheduler.`;

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

  // Immediately trigger A2A dispatch so the request is picked up
  triggerDispatch();

  return `Request created: **${id}**\n\n- **To**: ${service}\n- **Message**: ${message}\n- **File**: ${path.basename(filePath)}`;
}

// ── History reader ──────────────────────────────────────────────────────────

/** Read history JSONL entries for a specific request ID. */
function readHistoryForRequest(accordDir: string, requestId: string): string[] {
  const historyDir = path.join(accordDir, 'comms', 'history');
  if (!fs.existsSync(historyDir)) return [];

  const lines: string[] = [];
  try {
    const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.jsonl')).sort();
    for (const file of files) {
      const content = fs.readFileSync(path.join(historyDir, file), 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.request_id === requestId) {
            const parts = [`[${entry.ts}] ${entry.from_status} → ${entry.to_status}`];
            if (entry.actor) parts.push(`(${entry.actor})`);
            if (entry.duration_ms) parts.push(`${entry.duration_ms}ms`);
            if (entry.cost_usd !== undefined) parts.push(`$${entry.cost_usd.toFixed(4)}`);
            if (entry.num_turns) parts.push(`${entry.num_turns} turns`);
            if (entry.detail) parts.push(`— ${entry.detail}`);
            lines.push(parts.join(' '));
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  } catch (err) {
    logger.debug(`Failed to read history for ${requestId}: ${err}`);
  }
  return lines;
}

// ── Orchestrator prompt builder ─────────────────────────────────────────────

function buildServiceContext(serviceNames: string[], accordDir: string): string {
  const lines: string[] = [];
  for (const name of serviceNames) {
    const registry = loadRegistryYaml(accordDir, name);
    if (registry) {
      const parts = [`- **${name}**`];
      if (registry.description) parts.push(`— ${registry.description}`);
      if (registry.language) parts.push(`(${registry.language})`);
      if (registry.responsibility) parts.push(`| responsibility: ${registry.responsibility}`);
      lines.push(parts.join(' '));
    } else {
      lines.push(`- **${name}**`);
    }
  }
  return lines.join('\n');
}

function buildOrchestratorPrompt(userMessage: string, serviceNames: string[], accordDir: string, approvedPlan?: string): string {
  const templatePath = path.join(accordDir, 'comms', 'TEMPLATE.md');
  const hasTemplate = fs.existsSync(templatePath);
  const templateNote = hasTemplate
    ? 'Use the request template at `comms/TEMPLATE.md` for the correct format.'
    : 'Use standard frontmatter with id, from, to, scope, type, priority, status, created, updated fields.';

  const serviceContext = buildServiceContext(serviceNames, accordDir);

  // ── Execution mode: plan already approved, create request files ──
  if (approvedPlan) {
    return `## Role

You are the **orchestrator**. You coordinate work across services by creating request files.

**Rules:**
1. NEVER write application code — only protocol files in this hub directory.
2. Create request files in each service's inbox: \`comms/inbox/{service}/req-{id}.md\`
3. ${templateNote}
4. DO NOT use interactive tools (AskUserQuestion, EnterPlanMode, etc.) — communicate through text output only.

## Approved Plan

Execute this plan now:

${approvedPlan}

## Available Services

${serviceContext}

## User Message

${userMessage}`;
  }

  // ── Planning mode: discuss, clarify, propose plan ──
  return `## Role

You are the **orchestrator** — a planning and coordination agent. You help the user decompose tasks and dispatch them to the right services.

**Rules:**
1. NEVER write application code — only protocol files in this hub directory.
2. DO NOT create request files until the user explicitly approves your plan.
3. DO NOT use interactive tools (AskUserQuestion, EnterPlanMode, etc.) — just write your questions and plans as plain text output. The user will see your output and reply.

## Workflow

### Step 1: Understand
- Analyze the user's request
- If anything is unclear or could be approached in multiple ways, **write your clarifying questions as text output**
- Consider: scope, affected services, technical approach, priorities, dependencies, edge cases
- The user will reply with answers in the next message

### Step 2: Propose Plan
- Present a structured plan as text:
  - Which services are involved and what each should do
  - Order of execution and dependencies between tasks
  - Expected outcome
- Ask the user to confirm (e.g. "Does this plan look good? Reply to confirm or suggest changes.")

### Step 3: Execute (only after user confirms)
- Create request files in each service's inbox: \`comms/inbox/{service}/req-{id}.md\`
- ${templateNote}

**IMPORTANT:** Always go through Steps 1-2 first. Only create request files after the user explicitly says to proceed. Never use interactive tools — communicate through text output only.

## Available Services

${serviceContext}

## User Message

${userMessage}`;
}
