import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Dispatcher } from '../src/dispatcher.js';
import type { AccordConfig, DispatcherConfig } from '../src/types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accord-test-'));
  // Create minimal .accord structure
  fs.mkdirSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-a'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-b'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.accord', 'comms', 'archive'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.accord', 'log'), { recursive: true });
  // Init git repo for commit operations
  const { execFileSync } = require('node:child_process');
  execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'pipe' });
  // Initial commit so git add -A works
  fs.writeFileSync(path.join(tmpDir, '.gitignore'), '', 'utf-8');
  execFileSync('git', ['add', '-A'], { cwd: tmpDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'pipe' });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const SAMPLE_REQUEST = `---
id: req-001-test
from: svc-a
to: svc-b
scope: external
type: api-addition
priority: high
status: pending
created: 2026-02-10T10:00:00Z
updated: 2026-02-10T10:00:00Z
---

## What

A test request.
`;

const COMMAND_REQUEST = `---
id: req-cmd-001
from: orchestrator
to: svc-a
scope: external
type: command
priority: medium
status: pending
created: 2026-02-10T10:00:00Z
updated: 2026-02-10T10:00:00Z
command: status
---

## What

Run status check.
`;

function makeConfig(): AccordConfig {
  return {
    version: '0.1',
    project: { name: 'test' },
    repo_model: 'monorepo',
    services: [{ name: 'svc-a' }, { name: 'svc-b' }],
  };
}

function makeDispatcherConfig(overrides: Partial<DispatcherConfig> = {}): DispatcherConfig {
  return {
    workers: 2,
    poll_interval: 30,
    session_max_requests: 15,
    session_max_age_hours: 24,
    request_timeout: 600,
    max_attempts: 3,
    model: 'claude-sonnet-4-5-20250929',
    debug: false,
    ...overrides,
  };
}

describe('Dispatcher', () => {
  it('initializes with correct worker count', () => {
    const dispatcher = new Dispatcher(makeDispatcherConfig(), makeConfig(), tmpDir);
    expect(dispatcher.status.workers).toHaveLength(2);
    expect(dispatcher.status.running).toBe(false);
    expect(dispatcher.status.totalProcessed).toBe(0);
  });

  it('dry-run finds pending requests', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-b', 'req-001-test.md'),
      SAMPLE_REQUEST,
      'utf-8',
    );

    const dispatcher = new Dispatcher(makeDispatcherConfig(), makeConfig(), tmpDir);
    const count = await dispatcher.runOnce(true);
    expect(count).toBe(1);
  });

  it('dry-run returns 0 with no requests', async () => {
    const dispatcher = new Dispatcher(makeDispatcherConfig(), makeConfig(), tmpDir);
    const count = await dispatcher.runOnce(true);
    expect(count).toBe(0);
  });

  it('processes command requests via fast-path', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-a', 'req-cmd-001.md'),
      COMMAND_REQUEST,
      'utf-8',
    );

    const dispatcher = new Dispatcher(makeDispatcherConfig(), makeConfig(), tmpDir);
    const count = await dispatcher.runOnce(false);
    expect(count).toBe(1);

    // Verify request was archived
    const archived = fs.existsSync(path.join(tmpDir, '.accord', 'comms', 'archive', 'req-cmd-001.md'));
    expect(archived).toBe(true);

    // Verify inbox is empty
    const inboxFiles = fs.readdirSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-a'));
    expect(inboxFiles.filter(f => f.startsWith('req-'))).toHaveLength(0);
  });

  it('status tracks processed counts', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-a', 'req-cmd-001.md'),
      COMMAND_REQUEST,
      'utf-8',
    );

    const dispatcher = new Dispatcher(makeDispatcherConfig(), makeConfig(), tmpDir);
    await dispatcher.runOnce(false);

    const status = dispatcher.status;
    expect(status.totalProcessed).toBe(1);
  });

  it('monorepo: only one service processed per tick (shared directory constraint)', async () => {
    // In monorepo, svc-a and svc-b share the same directory.
    // Only one should be processed per tick — the other must wait.
    const cmdForA = `---
id: req-cmd-a
from: orchestrator
to: svc-a
scope: external
type: command
priority: medium
status: pending
created: "2026-02-12T10:00:00Z"
updated: "2026-02-12T10:00:00Z"
command: status
---

## What

Status check for A.
`;
    const cmdForB = `---
id: req-cmd-b
from: orchestrator
to: svc-b
scope: external
type: command
priority: medium
status: pending
created: "2026-02-12T10:00:00Z"
updated: "2026-02-12T10:00:00Z"
command: status
---

## What

Status check for B.
`;
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-a', 'req-cmd-a.md'),
      cmdForA,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-b', 'req-cmd-b.md'),
      cmdForB,
      'utf-8',
    );

    // Monorepo — both services resolve to the same directory
    const config = makeConfig();
    expect(config.repo_model).toBe('monorepo');

    const dispatcher = new Dispatcher(
      makeDispatcherConfig({ workers: 4 }),
      config,
      tmpDir,
    );

    // First tick: only one should be processed (shared directory)
    const count1 = await dispatcher.runOnce(false);
    expect(count1).toBe(1);

    // Second tick: the other one should now be processed
    const count2 = await dispatcher.runOnce(false);
    expect(count2).toBe(1);

    // Both should now be archived
    const archiveFiles = fs.readdirSync(path.join(tmpDir, '.accord', 'comms', 'archive'));
    expect(archiveFiles).toContain('req-cmd-a.md');
    expect(archiveFiles).toContain('req-cmd-b.md');
  });

  it('multi-repo dry-run: different services both assignable (separate directories)', async () => {
    // In multi-repo, svc-a resolves to ../svc-a and svc-b to ../svc-b.
    // Since they have different directories, both should be assigned in one tick.
    const cmdForA = `---
id: req-cmd-ma
from: orchestrator
to: svc-a
scope: external
type: command
priority: medium
status: pending
created: "2026-02-12T10:00:00Z"
updated: "2026-02-12T10:00:00Z"
command: status
---

## What

Status check.
`;
    const cmdForB = `---
id: req-cmd-mb
from: orchestrator
to: svc-b
scope: external
type: command
priority: medium
status: pending
created: "2026-02-12T10:00:00Z"
updated: "2026-02-12T10:00:00Z"
command: status
---

## What

Status check.
`;
    // Place requests in hub inbox
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-a', 'req-cmd-ma.md'),
      cmdForA,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-b', 'req-cmd-mb.md'),
      cmdForB,
      'utf-8',
    );

    const multiRepoConfig: AccordConfig = {
      version: '0.1',
      project: { name: 'test' },
      repo_model: 'multi-repo',
      services: [{ name: 'svc-a' }, { name: 'svc-b' }],
    };

    // Multi-repo dry-run: both assigned (different directories)
    const multiDispatcher = new Dispatcher(
      makeDispatcherConfig({ workers: 4 }),
      multiRepoConfig,
      tmpDir,
    );
    const multiCount = await multiDispatcher.runOnce(true);
    expect(multiCount).toBe(2);

    // Monorepo dry-run: only 1 assigned (shared directory constraint)
    const monoDispatcher = new Dispatcher(
      makeDispatcherConfig({ workers: 4 }),
      makeConfig(), // monorepo
      tmpDir,
    );
    const monoCount = await monoDispatcher.runOnce(true);
    expect(monoCount).toBe(1);
  });
});
