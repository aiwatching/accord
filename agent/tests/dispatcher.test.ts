import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Dispatcher } from '../server/dispatcher.js';
import { scanInboxes, getPendingRequests, sortByPriority } from '../server/scanner.js';
import type { AccordConfig, DispatcherConfig } from '../server/types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accord-test-'));
  fs.mkdirSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-a'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-b'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.accord', 'comms', 'archive'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.accord', 'log'), { recursive: true });
  const { execFileSync } = require('node:child_process');
  execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(tmpDir, '.gitignore'), '', 'utf-8');
  execFileSync('git', ['add', '-A'], { cwd: tmpDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'pipe' });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(overrides?: Partial<AccordConfig>): AccordConfig {
  return {
    version: '0.1',
    project: { name: 'test' },
    repo_model: 'monorepo',
    services: [{ name: 'svc-a' }, { name: 'svc-b' }],
    ...overrides,
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
    agent: 'claude-code',
    ...overrides,
  };
}

function scanPending(config: AccordConfig): ReturnType<typeof sortByPriority> {
  const accordDir = path.join(tmpDir, '.accord');
  return sortByPriority(getPendingRequests(scanInboxes(accordDir, config)));
}

describe('Dispatcher', () => {
  it('initializes in A2A-only mode', () => {
    const dispatcher = new Dispatcher(makeDispatcherConfig(), makeConfig(), tmpDir);
    expect(dispatcher.status.workers).toHaveLength(0); // No local workers
    expect(dispatcher.status.running).toBe(true);
    expect(dispatcher.status.totalProcessed).toBe(0);
  });

  it('dry-run skips requests without a2a_url', async () => {
    const config = makeConfig();
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-b', 'req-001-test.md'),
      `---
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
`,
      'utf-8',
    );

    const dispatcher = new Dispatcher(makeDispatcherConfig(), config, tmpDir);
    const count = await dispatcher.dispatch(scanPending(config), true);
    // No a2a_url → skipped
    expect(count).toBe(0);
  });

  it('dry-run finds requests for services with a2a_url', async () => {
    const config = makeConfig({
      services: [
        { name: 'svc-a', a2a_url: 'http://localhost:9001' },
        { name: 'svc-b', a2a_url: 'http://localhost:9002' },
      ],
    });

    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-a', 'req-001.md'),
      `---
id: req-001
from: orchestrator
to: svc-a
scope: external
type: api-addition
priority: medium
status: pending
created: 2026-02-10T10:00:00Z
updated: 2026-02-10T10:00:00Z
---

Test request.
`,
      'utf-8',
    );

    const dispatcher = new Dispatcher(makeDispatcherConfig(), config, tmpDir);
    const count = await dispatcher.dispatch(scanPending(config), true);
    expect(count).toBe(1);
  });

  it('dry-run returns 0 with no requests', async () => {
    const config = makeConfig();
    const dispatcher = new Dispatcher(makeDispatcherConfig(), config, tmpDir);
    const count = await dispatcher.dispatch(scanPending(config), true);
    expect(count).toBe(0);
  });

  it('monorepo: only one service dispatched per tick (shared directory constraint)', async () => {
    const config = makeConfig({
      services: [
        { name: 'svc-a', a2a_url: 'http://localhost:9001' },
        { name: 'svc-b', a2a_url: 'http://localhost:9002' },
      ],
    });

    fs.writeFileSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-a', 'req-a.md'), `---
id: req-a
from: orchestrator
to: svc-a
scope: external
type: api-addition
priority: medium
status: pending
created: 2026-02-12T10:00:00Z
updated: 2026-02-12T10:00:00Z
---

Test A.
`, 'utf-8');

    fs.writeFileSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-b', 'req-b.md'), `---
id: req-b
from: orchestrator
to: svc-b
scope: external
type: api-addition
priority: medium
status: pending
created: 2026-02-12T10:00:00Z
updated: 2026-02-12T10:00:00Z
---

Test B.
`, 'utf-8');

    expect(config.repo_model).toBe('monorepo');

    const dispatcher = new Dispatcher(makeDispatcherConfig(), config, tmpDir);
    const count = await dispatcher.dispatch(scanPending(config), true);

    // Monorepo: shared directory → only 1 dispatched
    expect(count).toBe(1);
  });

  it('multi-repo dry-run: different services both assignable (separate directories)', async () => {
    const multiRepoConfig: AccordConfig = {
      version: '0.1',
      project: { name: 'test' },
      repo_model: 'multi-repo',
      services: [
        { name: 'svc-a', a2a_url: 'http://localhost:9001' },
        { name: 'svc-b', a2a_url: 'http://localhost:9002' },
      ],
    };

    fs.writeFileSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-a', 'req-ma.md'), `---
id: req-ma
from: orchestrator
to: svc-a
scope: external
type: api-addition
priority: medium
status: pending
created: 2026-02-12T10:00:00Z
updated: 2026-02-12T10:00:00Z
---

Test.
`, 'utf-8');

    fs.writeFileSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'svc-b', 'req-mb.md'), `---
id: req-mb
from: orchestrator
to: svc-b
scope: external
type: api-addition
priority: medium
status: pending
created: 2026-02-12T10:00:00Z
updated: 2026-02-12T10:00:00Z
---

Test.
`, 'utf-8');

    const dispatcher = new Dispatcher(makeDispatcherConfig(), multiRepoConfig, tmpDir);
    const pending = sortByPriority(getPendingRequests(scanInboxes(path.join(tmpDir, '.accord'), multiRepoConfig)));
    const count = await dispatcher.dispatch(pending, true);
    // Multi-repo: separate directories → both assignable
    expect(count).toBe(2);
  });
});
