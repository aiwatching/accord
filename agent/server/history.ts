import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from './logger.js';

export interface HistoryTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface HistoryModelUsageEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}

export interface HistoryEntry {
  historyDir: string;
  requestId: string;
  fromStatus: string;
  toStatus: string;
  actor: string;
  directiveId?: string;
  detail?: string;
  durationMs?: number;
  costUsd?: number;
  numTurns?: number;
  usage?: HistoryTokenUsage;
  modelUsage?: Record<string, HistoryModelUsageEntry>;
}

/**
 * Find write-history.sh script.
 */
function findHistoryScript(): string | null {
  const candidates = [
    process.env['ACCORD_DIR'] ? path.join(process.env['ACCORD_DIR'], 'protocol', 'history', 'write-history.sh') : null,
    path.join(process.env['HOME'] ?? '', '.accord', 'protocol', 'history', 'write-history.sh'),
    path.resolve(import.meta.dirname, '..', '..', 'protocol', 'history', 'write-history.sh'),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function writeHistory(entry: HistoryEntry): void {
  const script = findHistoryScript();

  if (script) {
    const args = [
      script,
      '--history-dir', entry.historyDir,
      '--request-id', entry.requestId,
      '--from-status', entry.fromStatus,
      '--to-status', entry.toStatus,
      '--actor', entry.actor,
    ];
    if (entry.directiveId) args.push('--directive-id', entry.directiveId);
    if (entry.detail) args.push('--detail', entry.detail);

    try {
      execFileSync('bash', args, { stdio: 'pipe', timeout: 5_000 });
      return;
    } catch (err) {
      logger.warn(`write-history.sh failed, falling back to direct write: ${err}`);
    }
  }

  // Fallback: write JSONL directly
  writeHistoryDirect(entry);
}

function writeHistoryDirect(entry: HistoryEntry): void {
  fs.mkdirSync(entry.historyDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const filename = `${date}-${entry.actor}.jsonl`;
  const filepath = path.join(entry.historyDir, filename);

  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    request_id: entry.requestId,
    from_status: entry.fromStatus,
    to_status: entry.toStatus,
    actor: entry.actor,
  };
  if (entry.directiveId) record['directive_id'] = entry.directiveId;
  if (entry.detail) record['detail'] = entry.detail;
  if (entry.durationMs !== undefined) record['duration_ms'] = entry.durationMs;
  if (entry.costUsd !== undefined) record['cost_usd'] = entry.costUsd;
  if (entry.numTurns !== undefined) record['num_turns'] = entry.numTurns;
  if (entry.usage) record['usage'] = entry.usage;
  if (entry.modelUsage) record['model_usage'] = entry.modelUsage;

  fs.appendFileSync(filepath, JSON.stringify(record) + '\n', 'utf-8');
}
