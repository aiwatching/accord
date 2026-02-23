import type { FastifyInstance } from 'fastify';
import { getHubState } from '../hub-state.js';

export function registerWorkerRoutes(app: FastifyInstance): void {
  // GET /api/workers — dispatcher status (A2A mode)
  app.get('/api/workers', async () => {
    const { dispatcher } = getHubState();
    const status = dispatcher.status;

    return {
      mode: 'a2a',
      totalProcessed: status.totalProcessed,
      totalFailed: status.totalFailed,
      pendingQueue: status.pendingQueue,
    };
  });
}
