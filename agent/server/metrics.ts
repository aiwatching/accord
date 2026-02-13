import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RequestMetrics {
  requestId: string;
  serviceName: string;
  durationMs: number;
  success: boolean;
  costUsd?: number;
  numTurns?: number;
}

export interface ServiceMetrics {
  total: number;
  completed: number;
  failed: number;
  avgLatencyMs: number;
}

export interface TeamMetrics {
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  successRate: number;
  byService: Record<string, ServiceMetrics>;
}

// ── History entry shape (from JSONL) ─────────────────────────────────────────

interface HistoryRecord {
  ts: string;
  request_id: string;
  from_status: string;
  to_status: string;
  actor: string;
  directive_id?: string;
  detail?: string;
  duration_ms?: number;
  cost_usd?: number;
  num_turns?: number;
}

// ── Aggregation ──────────────────────────────────────────────────────────────

/**
 * Aggregate metrics from JSONL history files in the given directory.
 */
export function aggregateMetrics(historyDir: string): TeamMetrics {
  const metrics: TeamMetrics = {
    totalRequests: 0,
    completedRequests: 0,
    failedRequests: 0,
    avgLatencyMs: 0,
    totalCostUsd: 0,
    successRate: 0,
    byService: {},
  };

  if (!fs.existsSync(historyDir)) {
    return metrics;
  }

  const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.jsonl'));
  const allEntries: HistoryRecord[] = [];

  for (const file of files) {
    const filepath = path.join(historyDir, file);
    const lines = fs.readFileSync(filepath, 'utf-8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        allEntries.push(JSON.parse(line) as HistoryRecord);
      } catch {
        // skip malformed lines
      }
    }
  }

  // Count transitions to terminal states
  let totalLatency = 0;
  let latencyCount = 0;

  for (const entry of allEntries) {
    if (entry.to_status === 'completed' || entry.to_status === 'failed') {
      metrics.totalRequests += 1;

      // Determine service from actor
      const serviceName = entry.actor;

      if (!metrics.byService[serviceName]) {
        metrics.byService[serviceName] = { total: 0, completed: 0, failed: 0, avgLatencyMs: 0 };
      }
      const svc = metrics.byService[serviceName];
      svc.total += 1;

      if (entry.to_status === 'completed') {
        metrics.completedRequests += 1;
        svc.completed += 1;
      } else {
        metrics.failedRequests += 1;
        svc.failed += 1;
      }

      if (entry.duration_ms !== undefined) {
        totalLatency += entry.duration_ms;
        latencyCount += 1;

        // Track per-service latency (accumulate for averaging)
        svc.avgLatencyMs = ((svc.avgLatencyMs * (svc.total - 1)) + entry.duration_ms) / svc.total;
      }

      if (entry.cost_usd !== undefined) {
        metrics.totalCostUsd += entry.cost_usd;
      }
    }
  }

  if (latencyCount > 0) {
    metrics.avgLatencyMs = totalLatency / latencyCount;
  }
  if (metrics.totalRequests > 0) {
    metrics.successRate = metrics.completedRequests / metrics.totalRequests;
  }

  return metrics;
}
