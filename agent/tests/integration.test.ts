import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Dispatcher } from '../server/dispatcher.js';
import { scanInboxes, getPendingRequests, sortByPriority } from '../server/scanner.js';
import { validateContractUpdate } from '../server/a2a/contract-validator.js';
import { processContractUpdate } from '../server/a2a/contract-pipeline.js';
import type { AccordConfig, DispatcherConfig } from '../server/types.js';
import type { ContractUpdatePayload } from '../server/a2a/types.js';

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
  fs.mkdirSync(path.join(accord, 'contracts'), { recursive: true });
  fs.mkdirSync(path.join(accord, 'comms', 'inbox', 'backend'), { recursive: true });
  fs.mkdirSync(path.join(accord, 'comms', 'inbox', 'frontend'), { recursive: true });
  fs.mkdirSync(path.join(accord, 'comms', 'archive'), { recursive: true });
  fs.mkdirSync(path.join(accord, 'comms', 'history'), { recursive: true });
  fs.mkdirSync(path.join(accord, 'log'), { recursive: true });

  fs.writeFileSync(path.join(accord, 'contracts', 'backend.yaml'), `openapi: "3.0.3"
info:
  title: Backend API
  version: "1.0.0"
  x-accord-status: stable
paths:
  /api/users:
    get:
      summary: List users
`, 'utf-8');
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
    agent: 'claude-code',
  };
}

function makeAccordConfig(a2aServices = false): AccordConfig {
  return {
    version: '0.1',
    project: { name: 'integration-test' },
    repo_model: 'monorepo',
    services: [
      { name: 'backend', ...(a2aServices ? { a2a_url: 'http://localhost:9001' } : {}) },
      { name: 'frontend', ...(a2aServices ? { a2a_url: 'http://localhost:9002' } : {}) },
    ],
  };
}

function scanPending(config: AccordConfig) {
  const accordDir = path.join(tmpDir, '.accord');
  return sortByPriority(getPendingRequests(scanInboxes(accordDir, config)));
}

describe('Integration: A2A dispatcher', () => {
  it('skips requests for services without a2a_url', async () => {
    const config = makeAccordConfig(false);
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
---

Run status check.
`,
      'utf-8',
    );

    const dispatcher = new Dispatcher(makeDispatcherConfig(), config, tmpDir);
    const count = await dispatcher.dispatch(scanPending(config));

    // No a2a_url → 0 dispatched
    expect(count).toBe(0);

    // Request stays in inbox (not processed)
    const inboxFiles = fs.readdirSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'backend'));
    expect(inboxFiles).toContain('req-cmd-status.md');
  });

  it('dry-run with a2a_url counts as assignable', async () => {
    const config = makeAccordConfig(true);
    fs.writeFileSync(
      path.join(tmpDir, '.accord', 'comms', 'inbox', 'backend', 'req-001.md'),
      `---
id: req-001
from: orchestrator
to: backend
scope: external
type: api-addition
priority: high
status: pending
created: "2026-02-12T10:00:00Z"
updated: "2026-02-12T10:00:00Z"
---

Add new endpoint.
`,
      'utf-8',
    );

    const dispatcher = new Dispatcher(makeDispatcherConfig(), config, tmpDir);
    const count = await dispatcher.dispatch(scanPending(config), true);

    expect(count).toBe(1);

    // Dry-run: file should still be in inbox
    const inboxFiles = fs.readdirSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'backend'));
    expect(inboxFiles).toContain('req-001.md');
  });

  it('monorepo constraint: only one service per tick', async () => {
    const config = makeAccordConfig(true);

    fs.writeFileSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'backend', 'req-s1.md'), `---
id: req-s1
from: orchestrator
to: backend
scope: external
type: api-addition
priority: medium
status: pending
created: "2026-02-12T10:00:00Z"
updated: "2026-02-12T10:00:00Z"
---

Test.
`, 'utf-8');

    fs.writeFileSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'frontend', 'req-s2.md'), `---
id: req-s2
from: orchestrator
to: frontend
scope: external
type: api-addition
priority: medium
status: pending
created: "2026-02-12T10:00:00Z"
updated: "2026-02-12T10:00:00Z"
---

Test.
`, 'utf-8');

    const dispatcher = new Dispatcher(makeDispatcherConfig(), config, tmpDir);
    const count = await dispatcher.dispatch(scanPending(config), true);

    // Monorepo: shared directory → only 1
    expect(count).toBe(1);
  });

  it('priority sorting: critical before low in dry-run', async () => {
    const config = makeAccordConfig(true);

    fs.writeFileSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'backend', 'req-low.md'), `---
id: req-low
from: orchestrator
to: backend
scope: external
type: api-addition
priority: low
status: pending
created: "2026-02-12T10:00:00Z"
updated: "2026-02-12T10:00:00Z"
---

Low priority.
`, 'utf-8');

    fs.writeFileSync(path.join(tmpDir, '.accord', 'comms', 'inbox', 'backend', 'req-crit.md'), `---
id: req-crit
from: orchestrator
to: backend
scope: external
type: api-addition
priority: critical
status: pending
created: "2026-02-12T10:00:00Z"
updated: "2026-02-12T10:00:00Z"
---

Critical priority.
`, 'utf-8');

    const pending = scanPending(config);

    // Critical should come first
    expect(pending[0].frontmatter.priority).toBe('critical');
    expect(pending[1].frontmatter.priority).toBe('low');
  });
});

describe('Integration: contract pipeline', () => {
  it('validates and applies a valid contract update', () => {
    const accordDir = path.join(tmpDir, '.accord');
    const update: ContractUpdatePayload = {
      type: 'openapi-patch',
      contract_path: 'contracts/backend.yaml',
      operations: [
        {
          op: 'add',
          path: '/paths/~1api~1v1~1policies',
          value: {
            get: {
              summary: 'List policies',
              operationId: 'listPolicies',
            },
          },
        },
      ],
      contract_status_transition: 'stable -> proposed',
    };

    const result = processContractUpdate(update, 'req-001', 'backend', accordDir);

    expect(result.applied).toBe(true);
    expect(result.validation.valid).toBe(true);

    // Verify the YAML was updated
    const contractContent = fs.readFileSync(path.join(accordDir, 'contracts', 'backend.yaml'), 'utf-8');
    expect(contractContent).toContain('policies');
    expect(contractContent).toContain('proposed');
  });

  it('rejects contract update with invalid status transition', () => {
    const update: ContractUpdatePayload = {
      type: 'openapi-patch',
      contract_path: 'contracts/backend.yaml',
      operations: [{ op: 'add', path: '/paths/~1test', value: {} }],
      contract_status_transition: 'deprecated -> stable', // illegal
    };

    const validation = validateContractUpdate(update);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.code === 'ILLEGAL_TRANSITION')).toBe(true);
  });

  it('warns on breaking changes (path removal)', () => {
    const update: ContractUpdatePayload = {
      type: 'openapi-patch',
      contract_path: 'contracts/backend.yaml',
      operations: [{ op: 'remove', path: '/paths/~1api~1users' }],
    };

    const validation = validateContractUpdate(update);
    expect(validation.valid).toBe(true);
    expect(validation.warnings.some(w => w.code === 'BREAKING_PATH_REMOVAL')).toBe(true);
  });
});
