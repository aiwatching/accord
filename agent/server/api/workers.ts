import type { FastifyInstance } from 'fastify';
import { getHubState } from '../hub-state.js';

export function registerWorkerRoutes(app: FastifyInstance): void {
  // GET /api/workers — current worker pool status
  app.get('/api/workers', async () => {
    const { dispatcher } = getHubState();
    const status = dispatcher.status;

    return {
      totalWorkers: status.workers.length,
      activeWorkers: status.workers.filter(w => w.state === 'busy').length,
      idleWorkers: status.workers.filter(w => w.state === 'idle').length,
      totalProcessed: status.totalProcessed,
      totalFailed: status.totalFailed,
      pendingQueue: status.pendingQueue,
      workers: status.workers.map(w => ({
        id: w.workerId,
        state: w.state,
        currentRequest: w.currentRequest,
      })),
    };
  });
}
