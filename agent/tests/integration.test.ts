import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Dispatcher } from '../src/dispatcher.js';
import type { AccordConfig, DispatcherConfig } from '../src/types.js';

let tmpDir: string;

function initGitRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, '.gitignore'), '', 'utf-8');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
}

function writeAccordStructure(dir: string): void {
  const accord = path.join(dir, '.accord');
  // Config
  fs.mkdirSync(accord, { recursive: true });
  fs.writeFileSync(path.join(accord, 'config.yaml'), `
version: "0.1"
project:
  name: integration-test
repo_model: monorepo
services:
  - name: backend
  - name: frontend
settings:
  debug: false
`.trimStart(), 'utf-8');

  // Directories
  fs.mkdirSync(path.join(accord, 'contracts', 'internal'), { recursive: true });
  fs.mkdirSync(path.join(accord, 'comms', 'inbox', 'backend'), { recursive: true });
  fs.mkdirSync(path.join(accord, 'comms', 'inbox', 'frontend'), { recursive: true });
  fs.mkdirSync(path.join(accord, 'comms', 'archive'), { recursive: true });
  fs.mkdirSync(path.join(accord, 'comms', 'history'), { recursive: true });
  fs.mkdirSync(path.join(accord, 'log'), { recursive: true });
  fs.mkdirSync(path.join(accord, 'registry'), { recursive: true });

  // A contract
  fs.writeFileSync(path.join(accord, 'contracts', 'backend.yaml'), `
openapi: "3.0.0"
info:
  title: Backend API
  version: "1.0.0"
paths:
  /api/users:
    get:
      summary: List users
`.trimStart(), 'utf-8');

  // A registry
  fs.writeFileSync(path.join(accord, 'registry', 'backend.md'), `
# backend
Handles user management and authentication.
`.trimStart(), 'utf-8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accord-integ-'));
  writeAccordStructure(tmpDir);
  initGitRepo(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeDispatcherConfig(): DispatcherConfig {
  return {
    workers: 2,
    poll_interval: 30,
    session_max_requests: 15,
    session_max_age_hours: 24,
    request_timeout: 600,
    max_attempts: 3,
    model: 'claude-sonnet-4-5-20250929',
    debug: false,
  };
}

function makeAccordConfig(): AccordConfig {
  return {
    version: '0.1',
    project: { name: 'integration-test' },
    repo_model: 'monorepo',
    services: [{ name: 'backend' }, { name: 'frontend' }],
  };
}

describe('Integration: command request lifecycle', () => {
  it('processes a status command end-to-end', async () => {
    // Place a command request in the backend inbox
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'backend', 'req-cmd-status.md'),
      `---
id: req-cmd-status
from: orchestrator
to: backend
scope: external
type: command
priority: medium
status: pending
created: "2026-02-12T10:00:00Z"
updated: "2026-02-12T10:00:00Z"
command: status
---

## What

Run status check on backend service.
`,
      'utf-8',
    );

    const dispatcher = new Dispatcher(makeDispatcherConfig(), makeAccordConfig(), tmpDir);
    const count = await dispatcher.runOnce(false);

    expect(count).toBe(1);

    // Request should be archived
    const archiveFiles = fs.readdirSync(path.join(tmpDir, '.accord', 'comms', 'archive'));
    expect(archiveFiles).toContain('req-cmd-status.md');

    // Inbox should be empty
    const inboxFiles = fs.readdirSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'backend'));
    expect(inboxFiles.filter(f => f.startsWith('req-'))).toHaveLength(0);

    // Archived request should have ## Result section
    const archived = fs.readFileSync(
      path.join(tmpDir, '.accord', 'comms', 'archive', 'req-cmd-status.md'),
      'utf-8',
    );
    expect(archived).toContain('## Result');
    expect(archived).toContain('external');  // from status output

    // History should be written
    const historyFiles = fs.readdirSync(path.join(tmpDir, '.accord', 'comms', 'history'));
    expect(historyFiles.length).toBeGreaterThan(0);

    const historyContent = fs.readFileSync(
      path.join(tmpDir, '.accord', 'comms', 'history', historyFiles[0]),
      'utf-8',
    );
    expect(historyContent).toContain('req-cmd-status');
    expect(historyContent).toContain('completed');
  });

  it('processes check-inbox command and result includes inbox listing', async () => {
    // Place a non-pending request (won't be processed) just so check-inbox has something to list
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'frontend', 'req-010-add-button.md'),
      `---
id: req-010-add-button
from: backend
to: frontend
scope: external
type: api-addition
priority: high
status: in-progress
created: "2026-02-12T10:00:00Z"
updated: "2026-02-12T10:00:00Z"
---

## What

Add a logout button.
`,
      'utf-8',
    );

    // Place a command request to check-inbox
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'backend', 'req-cmd-inbox.md'),
      `---
id: req-cmd-inbox
from: orchestrator
to: backend
scope: external
type: command
priority: medium
status: pending
created: "2026-02-12T10:00:00Z"
updated: "2026-02-12T10:00:00Z"
command: check-inbox
---

## What

Check inbox.
`,
      'utf-8',
    );

    const dispatcher = new Dispatcher(makeDispatcherConfig(), makeAccordConfig(), tmpDir);
    const count = await dispatcher.runOnce(false);

    expect(count).toBeGreaterThanOrEqual(1);

    const archived = fs.readFileSync(
      path.join(tmpDir, '.accord', 'comms', 'archive', 'req-cmd-inbox.md'),
      'utf-8',
    );
    expect(archived).toContain('## Result');
    expect(archived).toContain('## Inbox');
  });

  it('monorepo: processes different-service requests sequentially (shared directory)', async () => {
    // In monorepo, backend and frontend share the same directory.
    // The directory constraint ensures only one is processed per tick.
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'backend', 'req-cmd-s1.md'),
      `---
id: req-cmd-s1
from: orchestrator
to: backend
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
`,
      'utf-8',
    );

    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'frontend', 'req-cmd-s2.md'),
      `---
id: req-cmd-s2
from: orchestrator
to: frontend
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
`,
      'utf-8',
    );

    const dispatcher = new Dispatcher(makeDispatcherConfig(), makeAccordConfig(), tmpDir);

    // First tick: only one processed (shared directory constraint)
    const count1 = await dispatcher.runOnce(false);
    expect(count1).toBe(1);

    // Second tick: the other one
    const count2 = await dispatcher.runOnce(false);
    expect(count2).toBe(1);

    // Both should now be archived
    const archiveFiles = fs.readdirSync(path.join(tmpDir, '.accord', 'comms', 'archive'));
    expect(archiveFiles).toContain('req-cmd-s1.md');
    expect(archiveFiles).toContain('req-cmd-s2.md');
  });

  it('dry-run does not modify any files', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'backend', 'req-cmd-dry.md'),
      `---
id: req-cmd-dry
from: orchestrator
to: backend
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
`,
      'utf-8',
    );

    const dispatcher = new Dispatcher(makeDispatcherConfig(), makeAccordConfig(), tmpDir);
    const count = await dispatcher.runOnce(true);

    expect(count).toBe(1);

    // Request should still be in inbox (not archived)
    const inboxFiles = fs.readdirSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'backend'));
    expect(inboxFiles).toContain('req-cmd-dry.md');

    // Archive should be empty
    const archiveFiles = fs.readdirSync(path.join(tmpDir, '.accord', 'comms', 'archive'));
    expect(archiveFiles).toHaveLength(0);
  });

  it('priority sorting: critical processed before medium', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'backend', 'req-cmd-low.md'),
      `---
id: req-cmd-low
from: orchestrator
to: backend
scope: external
type: command
priority: low
status: pending
created: "2026-02-12T10:00:00Z"
updated: "2026-02-12T10:00:00Z"
command: status
---

Low priority.
`,
      'utf-8',
    );

    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'backend', 'req-cmd-crit.md'),
      `---
id: req-cmd-crit
from: orchestrator
to: backend
scope: external
type: command
priority: critical
status: pending
created: "2026-02-12T10:00:00Z"
updated: "2026-02-12T10:00:00Z"
command: status
---

Critical priority.
`,
      'utf-8',
    );

    // With same-service constraint, only one can run per tick
    // The critical one should be picked first
    const dispatcher = new Dispatcher(
      { ...makeDispatcherConfig(), workers: 1 },
      makeAccordConfig(),
      tmpDir,
    );
    const count = await dispatcher.runOnce(false);

    // At least one processed
    expect(count).toBeGreaterThanOrEqual(1);

    // The critical one should be archived (processed first)
    const archiveFiles = fs.readdirSync(path.join(tmpDir, '.accord', 'comms', 'archive'));
    expect(archiveFiles).toContain('req-cmd-crit.md');
  });
});
