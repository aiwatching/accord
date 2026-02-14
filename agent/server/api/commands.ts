import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHubState } from '../hub-state.js';
import { getAccordDir, getServiceNames, getInboxPath } from '../config.js';
import { scanInboxes, scanArchives } from '../scanner.js';
import { executeCommand } from '../commands.js';
import { eventBus } from '../event-bus.js';
import { logger } from '../logger.js';

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
  let sessionBusy = false;

  app.post<{ Body: { message: string } }>('/api/session/send', async (req, reply) => {
    const message = (req.body.message ?? '').trim();
    if (!message) {
      return reply.status(400).send({ error: 'message is required' });
    }

    if (sessionBusy) {
      return reply.status(409).send({ error: 'Orchestrator session is busy. Wait for the current message to complete.' });
    }

    sessionBusy = true;
    const { hubDir, config, dispatcherConfig, dispatcher } = getHubState();
    const adapter = dispatcher.getAdapter();
    const sessionManager = dispatcher.getSessionManager();
    const accordDir = getAccordDir(hubDir, config);

    // Resolve existing session for resume
    const existing = adapter.supportsResume
      ? sessionManager.getSession('orchestrator')
      : undefined;
    const resumeId = existing?.sessionId;

    const startTime = Date.now();
    let streamIndex = 0;

    logger.info(`[session] Orchestrator message: ${message.slice(0, 80)}...`);

    // Persist session output to log file
    const sessionsDir = path.join(accordDir, 'comms', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const logFile = path.join(sessionsDir, 'orchestrator-session.log');
    fs.appendFileSync(logFile, `--- orchestrator | orchestrator | ${new Date().toISOString()} ---\n[YOU] ${message}\n`);

    eventBus.emit('session:start', {
      service: 'orchestrator',
      message: message.slice(0, 200),
    });

    try {
      const result = await adapter.invoke({
        prompt: message,
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

      // Update session for future resume
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

      return reply.status(500).send({
        success: false,
        error,
        durationMs: Date.now() - startTime,
      });
    } finally {
      sessionBusy = false;
    }
  });
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
