import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { getHubState } from '../hub-state.js';
import { getAccordDir } from '../config.js';

export function registerDirectiveRoutes(app: FastifyInstance): void {
  // GET /api/directives — list all directives
  app.get('/api/directives', async () => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const directivesDir = path.join(accordDir, 'directives');

    if (!fs.existsSync(directivesDir)) return [];

    const files = fs.readdirSync(directivesDir).filter(f => f.endsWith('.md'));
    return files.map(file => {
      const filePath = path.join(directivesDir, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      try {
        const { data, content } = matter(raw);
        return {
          id: data.id ?? path.basename(file, '.md'),
          status: data.status ?? 'unknown',
          priority: data.priority ?? 'medium',
          created: data.created,
          title: data.title ?? content.split('\n').find((l: string) => l.startsWith('#'))?.replace(/^#+\s*/, '') ?? file,
          filePath,
        };
      } catch {
        return { id: file, status: 'unknown', filePath };
      }
    });
  });

  // POST /api/directives — create a new directive
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
      const content = [
        '---',
        `id: ${id}`,
        `title: "${title.replace(/"/g, '\\"')}"`,
        `status: pending`,
        `priority: ${priority ?? 'medium'}`,
        `created: ${now}`,
        '---',
        '',
        `# ${title}`,
        '',
        body,
        '',
      ].join('\n');

      const filePath = path.join(directivesDir, `${id}.md`);
      fs.writeFileSync(filePath, content, 'utf-8');

      reply.status(201);
      return { id, filePath };
    },
  );
}
