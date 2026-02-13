import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildAgentPrompt, buildSessionSummary } from '../src/prompt.js';
import type { AccordRequest, RequestResult } from '../src/types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accord-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeRequest(overrides: Partial<AccordRequest> = {}): AccordRequest {
  return {
    frontmatter: {
      id: 'req-001-test',
      from: 'svc-a',
      to: 'svc-b',
      scope: 'external',
      type: 'api-addition',
      priority: 'high',
      status: 'pending',
      created: '2026-02-10T10:00:00Z',
      updated: '2026-02-10T10:00:00Z',
    },
    body: '## What\n\nAdd a new endpoint.\n\n## Why\n\nNeeded for feature X.',
    filePath: '/tmp/comms/inbox/svc-b/req-001-test.md',
    serviceName: 'svc-b',
    ...overrides,
  };
}

describe('buildAgentPrompt', () => {
  it('includes role header and request content', () => {
    const prompt = buildAgentPrompt({
      request: makeRequest(),
      serviceName: 'svc-b',
      targetDir: tmpDir,
      accordDir: tmpDir,
    });

    expect(prompt).toContain('Accord agent for the "svc-b" service');
    expect(prompt).toContain('req-001-test');
    expect(prompt).toContain('Add a new endpoint');
    expect(prompt).toContain('## Instructions');
  });

  it('includes registry content when present', () => {
    const registryDir = path.join(tmpDir, 'registry');
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(
      path.join(registryDir, 'svc-b.md'),
      '# svc-b\nHandles user management.',
      'utf-8',
    );

    const prompt = buildAgentPrompt({
      request: makeRequest(),
      serviceName: 'svc-b',
      targetDir: tmpDir,
      accordDir: tmpDir,
    });

    expect(prompt).toContain('## Service Registry');
    expect(prompt).toContain('Handles user management');
  });

  it('includes related contract when present', () => {
    const contractDir = path.join(tmpDir, 'contracts');
    fs.mkdirSync(contractDir, { recursive: true });
    fs.writeFileSync(
      path.join(contractDir, 'svc-b.yaml'),
      'openapi: "3.0.0"\ninfo:\n  title: svc-b API',
      'utf-8',
    );

    const req = makeRequest();
    req.frontmatter.related_contract = 'contracts/svc-b.yaml';

    const prompt = buildAgentPrompt({
      request: req,
      serviceName: 'svc-b',
      targetDir: tmpDir,
      accordDir: tmpDir,
    });

    expect(prompt).toContain('## Related Contract');
    expect(prompt).toContain('svc-b API');
  });

  it('includes checkpoint context when provided', () => {
    const prompt = buildAgentPrompt({
      request: makeRequest(),
      serviceName: 'svc-b',
      targetDir: tmpDir,
      accordDir: tmpDir,
      checkpoint: 'Error: timeout on previous attempt',
    });

    expect(prompt).toContain('## Previous Session Context');
    expect(prompt).toContain('timeout on previous attempt');
  });

  it('omits optional sections when not present', () => {
    const prompt = buildAgentPrompt({
      request: makeRequest(),
      serviceName: 'svc-b',
      targetDir: tmpDir,
      accordDir: tmpDir,
    });

    expect(prompt).not.toContain('## Service Registry');
    expect(prompt).not.toContain('## Related Contract');
    expect(prompt).not.toContain('## Previous Session Context');
    expect(prompt).not.toContain('## Available Skills');
  });
});

describe('buildSessionSummary', () => {
  it('returns empty string for no results', () => {
    expect(buildSessionSummary([])).toBe('');
  });

  it('formats successful results', () => {
    const results: RequestResult[] = [
      { requestId: 'req-001', success: true, durationMs: 5000, costUsd: 0.05, numTurns: 3 },
      { requestId: 'req-002', success: true, durationMs: 3000, costUsd: 0.02, numTurns: 2 },
    ];

    const summary = buildSessionSummary(results);
    expect(summary).toContain('req-001: completed ($0.0500) (3 turns)');
    expect(summary).toContain('req-002: completed ($0.0200) (2 turns)');
  });

  it('formats failed results', () => {
    const results: RequestResult[] = [
      { requestId: 'req-003', success: false, durationMs: 1000, error: 'timeout' },
    ];

    const summary = buildSessionSummary(results);
    expect(summary).toContain('req-003: failed');
  });
});
