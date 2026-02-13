import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { eventBus } from './event-bus.js';
import { registerServiceRoutes } from './api/services.js';
import { registerRequestRoutes } from './api/requests.js';
import { registerDirectiveRoutes } from './api/directives.js';
import { registerWorkerRoutes } from './api/workers.js';
import { registerHubRoutes } from './api/hub.js';
import { logger } from './logger.js';

let app: FastifyInstance | null = null;

export interface ServerContext {
  hubDir: string;
}

// Shared context accessible by route handlers
let serverContext: ServerContext | null = null;

export function getServerContext(): ServerContext {
  if (!serverContext) throw new Error('Server not initialized');
  return serverContext;
}

export async function startServer(port: number, hubDir: string): Promise<FastifyInstance> {
  serverContext = { hubDir };

  app = Fastify({ logger: false });

  // Plugins
  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // WebSocket endpoint
  app.register(async (fastify) => {
    fastify.get('/ws', { websocket: true }, (socket) => {
      logger.info('WebSocket client connected');
      const cleanup = eventBus.bridgeToWebSocket((msg) => socket.send(msg));
      socket.on('close', () => {
        logger.info('WebSocket client disconnected');
        cleanup();
      });
    });
  });

  // REST API routes
  registerServiceRoutes(app);
  registerRequestRoutes(app);
  registerDirectiveRoutes(app);
  registerWorkerRoutes(app);
  registerHubRoutes(app);

  // Serve static UI files in production
  const uiDistPath = path.resolve(hubDir, 'ui', 'dist');
  if (fs.existsSync(uiDistPath)) {
    await app.register(fastifyStatic, {
      root: uiDistPath,
      prefix: '/',
      wildcard: false,
    });

    // SPA fallback — serve index.html for all non-API, non-WS routes
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws')) {
        reply.status(404).send({ error: 'Not found' });
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`Hub Service listening on http://localhost:${port}`);

  return app;
}

export async function stopServer(): Promise<void> {
  if (app) {
    await app.close();
    app = null;
    logger.info('Server stopped');
  }
}
