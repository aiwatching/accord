import type { FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { getHubState } from '../hub-state.js';
import { getAccordDir } from '../config.js';
import { aggregateMetrics, collectAnalytics } from '../metrics.js';
import * as path from 'node:path';

export function registerHubRoutes(app: FastifyInstance): void {
  // GET /api/hub/status — hub sync status, metrics, scheduler info
  app.get('/api/hub/status', async () => {
    const { hubDir, config, scheduler } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const historyDir = path.join(accordDir, 'comms', 'history');

    // Git info
    let lastCommit = '';
    let branch = '';
    try {
      lastCommit = execFileSync('git', ['log', '--oneline', '-1'], {
        cwd: hubDir, stdio: 'pipe', timeout: 5_000,
      }).toString().trim();
    } catch { /* no git */ }

    try {
      branch = execFileSync('git', ['branch', '--show-current'], {
        cwd: hubDir, stdio: 'pipe', timeout: 5_000,
      }).toString().trim();
    } catch { /* no git */ }

    const metrics = aggregateMetrics(historyDir);

    return {
      project: config.project.name,
      version: config.version,
      repoModel: config.repo_model,
      role: config.role ?? 'service',
      branch,
      lastCommit,
      scheduler: scheduler.status,
      metrics: {
        totalRequests: metrics.totalRequests,
        completedRequests: metrics.completedRequests,
        failedRequests: metrics.failedRequests,
        successRate: metrics.successRate,
        avgLatencyMs: Math.round(metrics.avgLatencyMs),
        totalCostUsd: parseFloat(metrics.totalCostUsd.toFixed(4)),
      },
    };
  });

  // GET /api/hub/analytics — detailed cost/usage analytics
  app.get('/api/hub/analytics', async () => {
    const { hubDir, config } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const historyDir = path.join(accordDir, 'comms', 'history');
    return collectAnalytics(historyDir);
  });

  // POST /api/hub/sync — trigger manual sync (pull + push)
  app.post('/api/hub/sync', async () => {
    const { scheduler } = getHubState();
    const processed = await scheduler.triggerNow();
    return { triggered: true, processedCount: processed };
  });
}
