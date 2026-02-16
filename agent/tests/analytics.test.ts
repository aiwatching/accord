import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseDetailString, collectAnalytics } from '../server/metrics.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accord-analytics-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeJsonl(filename: string, entries: Record<string, unknown>[]): void {
  const historyDir = path.join(tmpDir, 'history');
  fs.mkdirSync(historyDir, { recursive: true });
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(path.join(historyDir, filename), content);
}

describe('parseDetailString', () => {
  it('extracts cost and turns from detail string', () => {
    const result = parseDetailString('cost=$1.3352, turns=49');
    expect(result.costUsd).toBeCloseTo(1.3352);
    expect(result.numTurns).toBe(49);
  });

  it('extracts cost without dollar sign', () => {
    const result = parseDetailString('cost=0.50, turns=10');
    expect(result.costUsd).toBeCloseTo(0.50);
    expect(result.numTurns).toBe(10);
  });

  it('returns empty for unrelated text', () => {
    const result = parseDetailString('completed successfully');
    expect(result.costUsd).toBeUndefined();
    expect(result.numTurns).toBeUndefined();
  });

  it('handles cost-only detail', () => {
    const result = parseDetailString('cost=$2.50');
    expect(result.costUsd).toBeCloseTo(2.50);
    expect(result.numTurns).toBeUndefined();
  });

  it('handles turns-only detail', () => {
    const result = parseDetailString('turns=25');
    expect(result.costUsd).toBeUndefined();
    expect(result.numTurns).toBe(25);
  });
});

describe('collectAnalytics', () => {
  it('returns zeroes for empty history directory', () => {
    const result = collectAnalytics(path.join(tmpDir, 'nonexistent'));
    expect(result.totals.totalRequests).toBe(0);
    expect(result.totals.totalCost).toBe(0);
    expect(result.totals.avgCost).toBe(0);
    expect(result.totals.avgTurns).toBe(0);
    expect(result.totals.successRate).toBe(0);
    expect(result.byService).toEqual([]);
    expect(result.byDay).toEqual([]);
    expect(result.requests).toEqual([]);
  });

  it('parses cost from proper cost_usd field', () => {
    writeJsonl('2026-02-10-svc-a.jsonl', [
      { ts: '2026-02-10T10:00:00Z', request_id: 'req-001', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a', cost_usd: 1.5, num_turns: 20 },
    ]);

    const result = collectAnalytics(path.join(tmpDir, 'history'));
    expect(result.totals.totalRequests).toBe(1);
    expect(result.totals.totalCost).toBeCloseTo(1.5);
    expect(result.requests[0].costUsd).toBeCloseTo(1.5);
    expect(result.requests[0].numTurns).toBe(20);
  });

  it('falls back to parsing cost from detail string', () => {
    writeJsonl('2026-02-10-svc-a.jsonl', [
      { ts: '2026-02-10T10:00:00Z', request_id: 'req-001', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a', detail: 'cost=$0.75, turns=12' },
    ]);

    const result = collectAnalytics(path.join(tmpDir, 'history'));
    expect(result.requests[0].costUsd).toBeCloseTo(0.75);
    expect(result.requests[0].numTurns).toBe(12);
  });

  it('prefers cost_usd over detail string', () => {
    writeJsonl('2026-02-10-svc-a.jsonl', [
      { ts: '2026-02-10T10:00:00Z', request_id: 'req-001', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a', cost_usd: 2.0, detail: 'cost=$0.50, turns=5' },
    ]);

    const result = collectAnalytics(path.join(tmpDir, 'history'));
    expect(result.requests[0].costUsd).toBeCloseTo(2.0);
  });

  it('computes per-service aggregates', () => {
    writeJsonl('2026-02-10-svc-a.jsonl', [
      { ts: '2026-02-10T10:00:00Z', request_id: 'req-001', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a', cost_usd: 1.0, num_turns: 10 },
      { ts: '2026-02-10T11:00:00Z', request_id: 'req-002', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a', cost_usd: 3.0, num_turns: 30 },
    ]);
    writeJsonl('2026-02-10-svc-b.jsonl', [
      { ts: '2026-02-10T12:00:00Z', request_id: 'req-003', from_status: 'in-progress', to_status: 'failed', actor: 'svc-b', cost_usd: 0.5, num_turns: 5 },
    ]);

    const result = collectAnalytics(path.join(tmpDir, 'history'));
    expect(result.byService).toHaveLength(2);

    // Sorted by totalCost desc
    const svcA = result.byService.find(s => s.service === 'svc-a')!;
    expect(svcA.requestCount).toBe(2);
    expect(svcA.totalCost).toBeCloseTo(4.0);
    expect(svcA.avgCost).toBeCloseTo(2.0);
    expect(svcA.totalTurns).toBe(40);
    expect(svcA.avgTurns).toBeCloseTo(20);
    expect(svcA.completed).toBe(2);
    expect(svcA.failed).toBe(0);

    const svcB = result.byService.find(s => s.service === 'svc-b')!;
    expect(svcB.requestCount).toBe(1);
    expect(svcB.failed).toBe(1);
    expect(svcB.completed).toBe(0);
  });

  it('computes per-day aggregates', () => {
    writeJsonl('2026-02-10-svc-a.jsonl', [
      { ts: '2026-02-10T10:00:00Z', request_id: 'req-001', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a', cost_usd: 1.0 },
    ]);
    writeJsonl('2026-02-11-svc-a.jsonl', [
      { ts: '2026-02-11T10:00:00Z', request_id: 'req-002', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a', cost_usd: 2.0 },
      { ts: '2026-02-11T11:00:00Z', request_id: 'req-003', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a', cost_usd: 3.0 },
    ]);

    const result = collectAnalytics(path.join(tmpDir, 'history'));
    expect(result.byDay).toHaveLength(2);
    expect(result.byDay[0].date).toBe('2026-02-10');
    expect(result.byDay[0].totalCost).toBeCloseTo(1.0);
    expect(result.byDay[0].requestCount).toBe(1);
    expect(result.byDay[1].date).toBe('2026-02-11');
    expect(result.byDay[1].totalCost).toBeCloseTo(5.0);
    expect(result.byDay[1].requestCount).toBe(2);
  });

  it('computes duration from in-progress to completed transitions', () => {
    writeJsonl('2026-02-10-svc-a.jsonl', [
      { ts: '2026-02-10T10:00:00Z', request_id: 'req-001', from_status: 'pending', to_status: 'in-progress', actor: 'svc-a' },
      { ts: '2026-02-10T10:05:00Z', request_id: 'req-001', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a', cost_usd: 1.0 },
    ]);

    const result = collectAnalytics(path.join(tmpDir, 'history'));
    expect(result.requests[0].durationMs).toBe(5 * 60 * 1000); // 5 minutes
  });

  it('uses duration_ms field when available', () => {
    writeJsonl('2026-02-10-svc-a.jsonl', [
      { ts: '2026-02-10T10:00:00Z', request_id: 'req-001', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a', duration_ms: 42000 },
    ]);

    const result = collectAnalytics(path.join(tmpDir, 'history'));
    expect(result.requests[0].durationMs).toBe(42000);
  });

  it('handles timestamp key variant instead of ts', () => {
    writeJsonl('2026-02-10-svc-a.jsonl', [
      { timestamp: '2026-02-10T10:00:00Z', request_id: 'req-001', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a', cost_usd: 0.5 },
    ]);

    const result = collectAnalytics(path.join(tmpDir, 'history'));
    expect(result.totals.totalRequests).toBe(1);
    expect(result.requests[0].timestamp).toBe('2026-02-10T10:00:00Z');
  });

  it('deduplicates repeated completions for same request', () => {
    writeJsonl('2026-02-10-svc-a.jsonl', [
      { ts: '2026-02-10T10:00:00Z', request_id: 'req-001', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a', cost_usd: 1.0 },
      { ts: '2026-02-10T10:05:00Z', request_id: 'req-001', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a', cost_usd: 2.0 },
    ]);

    const result = collectAnalytics(path.join(tmpDir, 'history'));
    expect(result.totals.totalRequests).toBe(1);
    // Should keep the last entry (cost=2.0)
    expect(result.requests[0].costUsd).toBeCloseTo(2.0);
  });

  it('computes success rate correctly', () => {
    writeJsonl('2026-02-10-svc-a.jsonl', [
      { ts: '2026-02-10T10:00:00Z', request_id: 'req-001', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a' },
      { ts: '2026-02-10T11:00:00Z', request_id: 'req-002', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a' },
      { ts: '2026-02-10T12:00:00Z', request_id: 'req-003', from_status: 'in-progress', to_status: 'failed', actor: 'svc-a' },
    ]);

    const result = collectAnalytics(path.join(tmpDir, 'history'));
    expect(result.totals.successRate).toBeCloseTo(2 / 3);
  });

  it('sorts requests by timestamp descending', () => {
    writeJsonl('2026-02-10-svc-a.jsonl', [
      { ts: '2026-02-10T08:00:00Z', request_id: 'req-old', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a' },
      { ts: '2026-02-10T12:00:00Z', request_id: 'req-new', from_status: 'in-progress', to_status: 'completed', actor: 'svc-a' },
    ]);

    const result = collectAnalytics(path.join(tmpDir, 'history'));
    expect(result.requests[0].requestId).toBe('req-new');
    expect(result.requests[1].requestId).toBe('req-old');
  });
});
