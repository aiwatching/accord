import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHubState, triggerDispatch } from '../hub-state.js';
import { getAccordDir, getInboxPath } from '../config.js';
import { scanInboxes, scanArchives, parseRequest, setRequestStatus, archiveRequest } from '../scanner.js';

export function registerRequestRoutes(app: FastifyInstance): void {
  // GET /api/requests — list all requests, filterable by service/status
  app.get<{ Querystring: { service?: string; status?: string } }>('/api/requests', async (req) => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    let requests = scanInboxes(accordDir, config, hubDir);

    // Also scan archive (root + team level for multi-team hubs)
    requests.push(...scanArchives(accordDir, config, hubDir));

    // Filter
    if (req.query.service) {
      requests = requests.filter(r => r.serviceName === req.query.service);
    }
    if (req.query.status) {
      requests = requests.filter(r => r.frontmatter.status === req.query.status);
    }

    return requests.map(r => ({
      id: r.frontmatter.id,
      from: r.frontmatter.from,
      to: r.frontmatter.to,
      service: r.serviceName,
      type: r.frontmatter.type,
      scope: r.frontmatter.scope,
      priority: r.frontmatter.priority,
      status: r.frontmatter.status,
      created: r.frontmatter.created,
      updated: r.frontmatter.updated,
      command: r.frontmatter.command,
      directive: r.frontmatter.directive,
      attempts: r.frontmatter.attempts,
      filePath: r.filePath,
    }));
  });

  // GET /api/requests/:id — single request detail (search inbox + archive)
  app.get<{ Params: { id: string } }>('/api/requests/:id', async (req, reply) => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const allRequests = scanInboxes(accordDir, config, hubDir);
    allRequests.push(...scanArchives(accordDir, config, hubDir));

    const found = allRequests.find(r => r.frontmatter.id === req.params.id);
    if (!found) return reply.status(404).send({ error: 'Request not found' });

    return {
      ...found.frontmatter,
      body: found.body,
      service: found.serviceName,
      filePath: found.filePath,
    };
  });

  // POST /api/requests — create a new request
  app.post<{ Body: { to: string; from: string; type: string; scope?: string; priority?: string; body: string; command?: string } }>(
    '/api/requests',
    async (req, reply) => {
      const { config, hubDir } = getHubState();
      const accordDir = getAccordDir(hubDir, config);
      const { to, from, type, scope, priority, body, command } = req.body;

      if (!to || !from || !type || !body) {
        return reply.status(400).send({ error: 'Missing required fields: to, from, type, body' });
      }

      const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      const inboxPath = getInboxPath(accordDir, to);
      fs.mkdirSync(inboxPath, { recursive: true });

      const frontmatter = [
        '---',
        `id: ${id}`,
        `from: ${from}`,
        `to: ${to}`,
        `scope: ${scope ?? 'external'}`,
        `type: ${type}`,
        `priority: ${priority ?? 'medium'}`,
        `status: pending`,
        `created: ${now}`,
        `updated: ${now}`,
        ...(command ? [`command: ${command}`] : []),
        '---',
      ].join('\n');

      const content = `${frontmatter}\n\n${body}\n`;
      const filePath = path.join(inboxPath, `${id}.md`);
      fs.writeFileSync(filePath, content, 'utf-8');

      // Immediately trigger A2A dispatch
      triggerDispatch();

      reply.status(201);
      return { id, filePath };
    },
  );

  // POST /api/requests/:id/cancel — cancel a pending request
  app.post<{ Params: { id: string } }>('/api/requests/:id/cancel', async (req, reply) => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);

    // Search inbox for the pending request
    const allRequests = scanInboxes(accordDir, config, hubDir);
    const found = allRequests.find(r => r.frontmatter.id === req.params.id);

    if (!found) {
      return reply.status(404).send({ error: 'Request not found in inbox' });
    }

    if (found.frontmatter.status !== 'pending') {
      return reply.status(400).send({ error: `Cannot cancel request with status '${found.frontmatter.status}', only 'pending' requests can be canceled` });
    }

    // Set status to rejected and archive
    setRequestStatus(found.filePath, 'rejected');
    archiveRequest(found.filePath, accordDir);

    return { id: req.params.id, status: 'rejected' };
  });

  // POST /api/requests/:id/retry — reset a failed/rejected request to pending
  app.post<{ Params: { id: string } }>('/api/requests/:id/retry', async (req, reply) => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);

    // Search archive for the failed/rejected request
    const archiveDir = path.join(accordDir, 'comms', 'archive');
    if (!fs.existsSync(archiveDir)) {
      return reply.status(404).send({ error: 'Archive directory not found' });
    }

    for (const file of fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'))) {
      const filePath = path.join(archiveDir, file);
      const parsed = parseRequest(filePath);
      if (parsed && parsed.frontmatter.id === req.params.id) {
        if (parsed.frontmatter.status !== 'failed' && parsed.frontmatter.status !== 'rejected') {
          return reply.status(400).send({ error: `Request status is '${parsed.frontmatter.status}', only 'failed' or 'rejected' can be retried` });
        }
        // Move back to inbox and set pending
        const inboxPath = getInboxPath(accordDir, parsed.serviceName);
        fs.mkdirSync(inboxPath, { recursive: true });
        const newPath = path.join(inboxPath, file);
        fs.renameSync(filePath, newPath);
        setRequestStatus(newPath, 'pending');

        // Trigger dispatch for retried request
        triggerDispatch();

        return { id: req.params.id, status: 'pending', filePath: newPath };
      }
    }

    return reply.status(404).send({ error: 'Request not found in archive' });
  });
}
