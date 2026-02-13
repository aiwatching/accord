import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHubState } from '../hub-state.js';
import { getAccordDir, getInboxPath } from '../config.js';
import { scanInboxes, parseRequest, setRequestStatus } from '../request.js';

export function registerRequestRoutes(app: FastifyInstance): void {
  // GET /api/requests — list all requests, filterable by service/status
  app.get<{ Querystring: { service?: string; status?: string } }>('/api/requests', async (req) => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    let requests = scanInboxes(accordDir, config);

    // Also scan archive
    const archiveDir = path.join(accordDir, 'comms', 'archive');
    if (fs.existsSync(archiveDir)) {
      for (const file of fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'))) {
        const parsed = parseRequest(path.join(archiveDir, file));
        if (parsed) requests.push(parsed);
      }
    }

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
    const allRequests = scanInboxes(accordDir, config);

    // Also scan archive
    const archiveDir = path.join(accordDir, 'comms', 'archive');
    if (fs.existsSync(archiveDir)) {
      for (const file of fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'))) {
        const parsed = parseRequest(path.join(archiveDir, file));
        if (parsed) allRequests.push(parsed);
      }
    }

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

      reply.status(201);
      return { id, filePath };
    },
  );

  // POST /api/requests/:id/retry — reset a failed request to pending
  app.post<{ Params: { id: string } }>('/api/requests/:id/retry', async (req, reply) => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);

    // Search archive for the failed request
    const archiveDir = path.join(accordDir, 'comms', 'archive');
    if (!fs.existsSync(archiveDir)) {
      return reply.status(404).send({ error: 'Archive directory not found' });
    }

    for (const file of fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'))) {
      const filePath = path.join(archiveDir, file);
      const parsed = parseRequest(filePath);
      if (parsed && parsed.frontmatter.id === req.params.id) {
        if (parsed.frontmatter.status !== 'failed') {
          return reply.status(400).send({ error: `Request status is '${parsed.frontmatter.status}', not 'failed'` });
        }
        // Move back to inbox and set pending
        const inboxPath = getInboxPath(accordDir, parsed.serviceName);
        fs.mkdirSync(inboxPath, { recursive: true });
        const newPath = path.join(inboxPath, file);
        fs.renameSync(filePath, newPath);
        setRequestStatus(newPath, 'pending');
        return { id: req.params.id, status: 'pending', filePath: newPath };
      }
    }

    return reply.status(404).send({ error: 'Request not found in archive' });
  });
}
