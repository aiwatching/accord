import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { getHubState } from '../hub-state.js';
import { getAccordDir } from '../config.js';
import { scanDirectives, getDirectiveRequestStatuses } from '../scanner.js';
import type { DirectivePhase } from '../types.js';

export function registerDirectiveRoutes(app: FastifyInstance): void {
  // GET /api/directives — list all directives (enhanced with requests + phase)
  app.get('/api/directives', async () => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const directives = scanDirectives(accordDir);

    return directives.map(d => ({
      id: d.frontmatter.id,
      title: d.frontmatter.title,
      status: d.frontmatter.status,
      priority: d.frontmatter.priority,
      created: d.frontmatter.created,
      updated: d.frontmatter.updated,
      requests: d.frontmatter.requests,
      contract_proposals: d.frontmatter.contract_proposals,
      test_requests: d.frontmatter.test_requests,
      retry_count: d.frontmatter.retry_count,
      filePath: d.filePath,
    }));
  });

  // GET /api/directives/:id — full directive details + request statuses
  app.get<{ Params: { id: string } }>('/api/directives/:id', async (req, reply) => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const directives = scanDirectives(accordDir);
    const directive = directives.find(d => d.frontmatter.id === req.params.id);

    if (!directive) {
      return reply.status(404).send({ error: 'Directive not found' });
    }

    // Collect all known request IDs from the directive's own tracking arrays
    const allKnownIds = [
      ...directive.frontmatter.requests,
      ...(directive.frontmatter.contract_proposals ?? []),
      ...(directive.frontmatter.test_requests ?? []),
    ];
    const requestStatuses = getDirectiveRequestStatuses(accordDir, config, directive.frontmatter.id, hubDir, allKnownIds);

    return {
      ...directive.frontmatter,
      body: directive.body,
      filePath: directive.filePath,
      requestStatuses: Object.fromEntries(requestStatuses),
    };
  });

  // GET /api/directives/:id/requests — all request statuses for a directive
  app.get<{ Params: { id: string } }>('/api/directives/:id/requests', async (req, reply) => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const directives = scanDirectives(accordDir);
    const directive = directives.find(d => d.frontmatter.id === req.params.id);

    if (!directive) {
      return reply.status(404).send({ error: 'Directive not found' });
    }

    const allKnownIds = [
      ...directive.frontmatter.requests,
      ...(directive.frontmatter.contract_proposals ?? []),
      ...(directive.frontmatter.test_requests ?? []),
    ];
    const statuses = getDirectiveRequestStatuses(accordDir, config, directive.frontmatter.id, hubDir, allKnownIds);
    return Object.fromEntries(statuses);
  });

  // POST /api/directives/:id/phase — manual phase override
  app.post<{ Params: { id: string }; Body: { phase: DirectivePhase; message?: string } }>(
    '/api/directives/:id/phase',
    async (req, reply) => {
      const { config, hubDir } = getHubState();
      const accordDir = getAccordDir(hubDir, config);
      const directivesDir = path.join(accordDir, 'directives');
      const directives = scanDirectives(accordDir);
      const directive = directives.find(d => d.frontmatter.id === req.params.id);

      if (!directive) {
        return reply.status(404).send({ error: 'Directive not found' });
      }

      const { phase, message } = req.body;
      const validPhases: DirectivePhase[] = ['planning', 'negotiating', 'implementing', 'testing', 'completed', 'failed'];
      if (!validPhases.includes(phase)) {
        return reply.status(400).send({ error: `Invalid phase: ${phase}` });
      }

      // If coordinator is active, use it for transition; otherwise manual update
      const { coordinator } = getHubState() as any;
      if (coordinator) {
        coordinator.transitionDirective(directive, phase, message ?? 'Manual phase override');
      } else {
        directive.frontmatter.status = phase;
        directive.frontmatter.updated = new Date().toISOString();
        const content = matter.stringify(directive.body, directive.frontmatter as unknown as Record<string, unknown>);
        fs.writeFileSync(directive.filePath, content, 'utf-8');
      }

      return { id: directive.frontmatter.id, status: phase };
    },
  );

  // POST /api/directives — create a new directive (enhanced with DirectiveFrontmatter format)
  app.post<{ Body: { title: string; body: string; priority?: string } }>(
    '/api/directives',
    async (req, reply) => {
      const { config, hubDir } = getHubState();
      const accordDir = getAccordDir(hubDir, config);
      const directivesDir = path.join(accordDir, 'directives');
      fs.mkdirSync(directivesDir, { recursive: true });

      const { title, body, priority } = req.body;
      if (!title || !body) {
        return reply.status(400).send({ error: 'Missing required fields: title, body' });
      }

      const id = `directive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();

      const frontmatterObj = {
        id,
        title,
        status: 'planning' as const,
        priority: priority ?? 'medium',
        created: now,
        updated: now,
        requests: [],
        contract_proposals: [],
        test_requests: [],
        retry_count: 0,
        max_retries: 3,
      };

      const bodyContent = `# ${title}\n\n${body}\n`;
      const content = matter.stringify(bodyContent, frontmatterObj);

      const filePath = path.join(directivesDir, `${id}.md`);
      fs.writeFileSync(filePath, content, 'utf-8');

      reply.status(201);
      return { id, filePath };
    },
  );
}
