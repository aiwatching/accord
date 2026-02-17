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

// ── Analytics types ─────────────────────────────────────────────────────────

export interface AnalyticsTokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface AnalyticsModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export interface AnalyticsRequestEntry {
  requestId: string;
  service: string;
  costUsd: number;
  numTurns: number;
  durationMs: number;
  timestamp: string;
  status: string;
  tokens?: AnalyticsTokenBreakdown;
  modelUsage?: AnalyticsModelUsage[];
}

export interface AnalyticsServiceAggregate {
  service: string;
  requestCount: number;
  totalCost: number;
  avgCost: number;
  totalTurns: number;
  avgTurns: number;
  completed: number;
  failed: number;
  tokens: AnalyticsTokenBreakdown;
}

export interface AnalyticsDayEntry {
  date: string;
  totalCost: number;
  requestCount: number;
  avgCost: number;
}

export interface AnalyticsData {
  totals: {
    totalRequests: number;
    totalCost: number;
    avgCost: number;
    avgTurns: number;
    successRate: number;
    tokens: AnalyticsTokenBreakdown;
  };
  byService: AnalyticsServiceAggregate[];
  byDay: AnalyticsDayEntry[];
  byModel: AnalyticsModelUsage[];
  requests: AnalyticsRequestEntry[];
}

// ── History entry shape (from JSONL) ─────────────────────────────────────────

interface HistoryTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

interface HistoryModelUsageEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}

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
  usage?: HistoryTokenUsage;
  model_usage?: Record<string, HistoryModelUsageEntry>;
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

// ── Detail string parsing ───────────────────────────────────────────────────

/**
 * Extract cost and turns from legacy detail strings like "cost=$1.3352, turns=49".
 */
export function parseDetailString(detail: string): { costUsd?: number; numTurns?: number } {
  const result: { costUsd?: number; numTurns?: number } = {};

  const costMatch = detail.match(/cost=\$?([\d.]+)/);
  if (costMatch) {
    const val = parseFloat(costMatch[1]);
    if (!isNaN(val)) result.costUsd = val;
  }

  const turnsMatch = detail.match(/turns=(\d+)/);
  if (turnsMatch) {
    const val = parseInt(turnsMatch[1], 10);
    if (!isNaN(val)) result.numTurns = val;
  }

  return result;
}

// ── Analytics collection ────────────────────────────────────────────────────

/**
 * Collect detailed analytics data from JSONL history files.
 */
export function collectAnalytics(historyDir: string): AnalyticsData {
  const emptyTokens: AnalyticsTokenBreakdown = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const empty: AnalyticsData = {
    totals: { totalRequests: 0, totalCost: 0, avgCost: 0, avgTurns: 0, successRate: 0, tokens: { ...emptyTokens } },
    byService: [],
    byDay: [],
    byModel: [],
    requests: [],
  };

  if (!fs.existsSync(historyDir)) return empty;

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

  if (allEntries.length === 0) return empty;

  // Index in-progress timestamps by request_id for duration calculation
  const inProgressTimestamps = new Map<string, string>();
  // Collect terminal entries, dedup by request_id (keep last)
  const terminalByRequest = new Map<string, HistoryRecord>();

  for (const entry of allEntries) {
    // Handle both `ts` and `timestamp` keys
    const ts = entry.ts ?? (entry as unknown as Record<string, unknown>)['timestamp'] as string | undefined;
    if (ts && !entry.ts) {
      entry.ts = ts;
    }

    if (entry.to_status === 'in-progress' && entry.ts) {
      inProgressTimestamps.set(entry.request_id, entry.ts);
    }

    if (entry.to_status === 'completed' || entry.to_status === 'failed') {
      terminalByRequest.set(entry.request_id, entry);
    }
  }

  // Build per-request entries
  const requestEntries: AnalyticsRequestEntry[] = [];
  const serviceMap = new Map<string, { totalCost: number; totalTurns: number; completed: number; failed: number; count: number; tokens: AnalyticsTokenBreakdown }>();
  const dayMap = new Map<string, { totalCost: number; count: number }>();

  for (const [requestId, record] of terminalByRequest) {
    // Resolve cost: prefer cost_usd field, fallback to detail string
    let costUsd = record.cost_usd ?? 0;
    let numTurns = record.num_turns ?? 0;

    if (record.detail) {
      const parsed = parseDetailString(record.detail);
      if (costUsd === 0 && parsed.costUsd !== undefined) costUsd = parsed.costUsd;
      if (numTurns === 0 && parsed.numTurns !== undefined) numTurns = parsed.numTurns;
    }

    // Compute duration from in-progress → completed transition
    let durationMs = record.duration_ms ?? 0;
    if (durationMs === 0 && record.ts) {
      const startTs = inProgressTimestamps.get(requestId);
      if (startTs) {
        const start = new Date(startTs).getTime();
        const end = new Date(record.ts).getTime();
        if (!isNaN(start) && !isNaN(end) && end > start) {
          durationMs = end - start;
        }
      }
    }

    const timestamp = record.ts ?? '';
    const service = record.actor;
    const status = record.to_status;

    // Token breakdown
    let tokens: AnalyticsTokenBreakdown | undefined;
    if (record.usage) {
      tokens = {
        inputTokens: record.usage.input_tokens ?? 0,
        outputTokens: record.usage.output_tokens ?? 0,
        cacheCreationTokens: record.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: record.usage.cache_read_input_tokens ?? 0,
      };
    }

    // Per-model usage
    let modelUsageList: AnalyticsModelUsage[] | undefined;
    if (record.model_usage) {
      modelUsageList = Object.entries(record.model_usage).map(([model, mu]) => ({
        model,
        inputTokens: mu.inputTokens ?? 0,
        outputTokens: mu.outputTokens ?? 0,
        cacheReadTokens: mu.cacheReadInputTokens ?? 0,
        cacheCreationTokens: mu.cacheCreationInputTokens ?? 0,
        costUsd: mu.costUSD ?? 0,
      }));
    }

    requestEntries.push({ requestId, service, costUsd, numTurns, durationMs, timestamp, status, tokens, modelUsage: modelUsageList });

    // Accumulate per-service
    let svc = serviceMap.get(service);
    if (!svc) {
      svc = { totalCost: 0, totalTurns: 0, completed: 0, failed: 0, count: 0, tokens: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } };
      serviceMap.set(service, svc);
    }
    svc.count += 1;
    svc.totalCost += costUsd;
    svc.totalTurns += numTurns;
    if (status === 'completed') svc.completed += 1;
    else svc.failed += 1;
    if (tokens) {
      svc.tokens.inputTokens += tokens.inputTokens;
      svc.tokens.outputTokens += tokens.outputTokens;
      svc.tokens.cacheCreationTokens += tokens.cacheCreationTokens;
      svc.tokens.cacheReadTokens += tokens.cacheReadTokens;
    }

    // Accumulate per-day
    const dateKey = timestamp ? timestamp.slice(0, 10) : 'unknown';
    let day = dayMap.get(dateKey);
    if (!day) {
      day = { totalCost: 0, count: 0 };
      dayMap.set(dateKey, day);
    }
    day.totalCost += costUsd;
    day.count += 1;
  }

  // Sort requests by timestamp descending
  requestEntries.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  // Build per-service aggregates
  const byService: AnalyticsServiceAggregate[] = [];
  for (const [service, data] of serviceMap) {
    byService.push({
      service,
      requestCount: data.count,
      totalCost: data.totalCost,
      avgCost: data.count > 0 ? data.totalCost / data.count : 0,
      totalTurns: data.totalTurns,
      avgTurns: data.count > 0 ? data.totalTurns / data.count : 0,
      completed: data.completed,
      failed: data.failed,
      tokens: data.tokens,
    });
  }
  byService.sort((a, b) => b.totalCost - a.totalCost);

  // Build per-day aggregates
  const byDay: AnalyticsDayEntry[] = [];
  for (const [date, data] of dayMap) {
    byDay.push({
      date,
      totalCost: data.totalCost,
      requestCount: data.count,
      avgCost: data.count > 0 ? data.totalCost / data.count : 0,
    });
  }
  byDay.sort((a, b) => a.date.localeCompare(b.date));

  // Compute totals
  const totalRequests = requestEntries.length;
  const totalCost = requestEntries.reduce((s, r) => s + r.costUsd, 0);
  const totalTurns = requestEntries.reduce((s, r) => s + r.numTurns, 0);
  const completedCount = requestEntries.filter(r => r.status === 'completed').length;

  // Aggregate token totals
  const totalTokens: AnalyticsTokenBreakdown = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  for (const req of requestEntries) {
    if (req.tokens) {
      totalTokens.inputTokens += req.tokens.inputTokens;
      totalTokens.outputTokens += req.tokens.outputTokens;
      totalTokens.cacheCreationTokens += req.tokens.cacheCreationTokens;
      totalTokens.cacheReadTokens += req.tokens.cacheReadTokens;
    }
  }

  // Aggregate per-model usage across all requests
  const modelMap = new Map<string, { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; costUsd: number }>();
  for (const req of requestEntries) {
    if (req.modelUsage) {
      for (const mu of req.modelUsage) {
        let entry = modelMap.get(mu.model);
        if (!entry) {
          entry = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 };
          modelMap.set(mu.model, entry);
        }
        entry.inputTokens += mu.inputTokens;
        entry.outputTokens += mu.outputTokens;
        entry.cacheReadTokens += mu.cacheReadTokens;
        entry.cacheCreationTokens += mu.cacheCreationTokens;
        entry.costUsd += mu.costUsd;
      }
    }
  }
  const byModel: AnalyticsModelUsage[] = [];
  for (const [model, data] of modelMap) {
    byModel.push({ model, ...data });
  }
  byModel.sort((a, b) => b.costUsd - a.costUsd);

  return {
    totals: {
      totalRequests,
      totalCost,
      avgCost: totalRequests > 0 ? totalCost / totalRequests : 0,
      avgTurns: totalRequests > 0 ? totalTurns / totalRequests : 0,
      successRate: totalRequests > 0 ? completedCount / totalRequests : 0,
      tokens: totalTokens,
    },
    byService,
    byDay,
    byModel,
    requests: requestEntries,
  };
}
