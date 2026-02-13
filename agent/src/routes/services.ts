import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHubState } from '../hub-state.js';
import { getAccordDir, getServiceDir, loadRegistryYaml } from '../config.js';
import { scanInboxes } from '../request.js';

export function registerServiceRoutes(app: FastifyInstance): void {
  // GET /api/services — list all services with status
  app.get('/api/services', async () => {
    const { config, hubDir, dispatcher } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const allRequests = scanInboxes(accordDir, config);
    const workerStatuses = dispatcher.status.workers;

    return config.services.map(svc => {
      const registry = loadRegistryYaml(accordDir, svc.name);
      const pendingCount = allRequests.filter(
        r => r.serviceName === svc.name && (r.frontmatter.status === 'pending' || r.frontmatter.status === 'approved')
      ).length;
      const activeWorker = workerStatuses.find(w => w.currentRequest && w.state === 'busy');
      const isWorking = workerStatuses.some(
        w => w.state === 'busy' && allRequests.some(
          r => r.serviceName === svc.name && r.frontmatter.id === w.currentRequest
        )
      );

      return {
        name: svc.name,
        type: svc.type ?? 'service',
        directory: svc.directory,
        language: svc.language,
        maintainer: registry?.maintainer ?? 'unknown',
        description: registry?.description ?? null,
        status: isWorking ? 'working' : pendingCount > 0 ? 'pending' : 'idle',
        pendingRequests: pendingCount,
      };
    });
  });

  // GET /api/services/:name — single service detail
  app.get<{ Params: { name: string } }>('/api/services/:name', async (req, reply) => {
    const { config, hubDir } = getHubState();
    const svc = config.services.find(s => s.name === req.params.name);
    if (!svc) return reply.status(404).send({ error: 'Service not found' });

    const accordDir = getAccordDir(hubDir, config);
    const registry = loadRegistryYaml(accordDir, svc.name);
    const allRequests = scanInboxes(accordDir, config);
    const serviceRequests = allRequests.filter(r => r.serviceName === svc.name);

    // Check archive too
    const archiveDir = path.join(accordDir, 'comms', 'archive');
    const archivedFiles: string[] = [];
    if (fs.existsSync(archiveDir)) {
      archivedFiles.push(...fs.readdirSync(archiveDir).filter(f => f.endsWith('.md')));
    }

    return {
      name: svc.name,
      type: svc.type ?? 'service',
      directory: svc.directory ?? getServiceDir(config, svc.name, hubDir),
      language: svc.language,
      repo: svc.repo,
      registry: registry ?? null,
      requests: serviceRequests.map(r => ({
        id: r.frontmatter.id,
        status: r.frontmatter.status,
        priority: r.frontmatter.priority,
        type: r.frontmatter.type,
        from: r.frontmatter.from,
        created: r.frontmatter.created,
      })),
      archivedCount: archivedFiles.length,
    };
  });

  // GET /api/services/:name/registry — raw registry content
  app.get<{ Params: { name: string } }>('/api/services/:name/registry', async (req, reply) => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const registry = loadRegistryYaml(accordDir, req.params.name);
    if (!registry) return reply.status(404).send({ error: 'Registry not found' });
    return registry;
  });
}
