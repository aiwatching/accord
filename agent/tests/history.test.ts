import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeHistory } from '../src/history.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accord-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('writeHistory', () => {
  it('creates history directory and writes JSONL', () => {
    const historyDir = path.join(tmpDir, 'history');

    writeHistory({
      historyDir,
      requestId: 'req-001-test',
      fromStatus: 'pending',
      toStatus: 'in-progress',
      actor: 'svc-a',
    });

    expect(fs.existsSync(historyDir)).toBe(true);

    const files = fs.readdirSync(historyDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}-svc-a\.jsonl$/);

    const content = fs.readFileSync(path.join(historyDir, files[0]), 'utf-8').trim();
    const entry = JSON.parse(content);
    expect(entry.request_id).toBe('req-001-test');
    expect(entry.from_status).toBe('pending');
    expect(entry.to_status).toBe('in-progress');
    expect(entry.actor).toBe('svc-a');
    expect(entry.ts).toBeDefined();
  });

  it('includes optional directiveId and detail', () => {
    const historyDir = path.join(tmpDir, 'history');

    writeHistory({
      historyDir,
      requestId: 'req-002',
      fromStatus: 'in-progress',
      toStatus: 'completed',
      actor: 'svc-b',
      directiveId: 'dir-001',
      detail: 'cost=$0.05, turns=3',
    });

    const files = fs.readdirSync(historyDir);
    const content = fs.readFileSync(path.join(historyDir, files[0]), 'utf-8').trim();
    const entry = JSON.parse(content);
    expect(entry.directive_id).toBe('dir-001');
    expect(entry.detail).toBe('cost=$0.05, turns=3');
  });

  it('appends multiple entries to same file', () => {
    const historyDir = path.join(tmpDir, 'history');

    writeHistory({
      historyDir,
      requestId: 'req-001',
      fromStatus: 'pending',
      toStatus: 'in-progress',
      actor: 'svc-a',
    });

    writeHistory({
      historyDir,
      requestId: 'req-001',
      fromStatus: 'in-progress',
      toStatus: 'completed',
      actor: 'svc-a',
    });

    const files = fs.readdirSync(historyDir);
    expect(files).toHaveLength(1); // same actor, same day = same file

    const lines = fs.readFileSync(path.join(historyDir, files[0]), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const entry1 = JSON.parse(lines[0]);
    const entry2 = JSON.parse(lines[1]);
    expect(entry1.to_status).toBe('in-progress');
    expect(entry2.to_status).toBe('completed');
  });
});
