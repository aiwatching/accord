import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  parseRequest,
  setRequestStatus,
  updateRequestField,
  incrementAttempts,
  archiveRequest,
  appendResultSection,
  scanInboxes,
  getPendingRequests,
  sortByPriority,
} from '../src/request.js';
import type { AccordConfig, AccordRequest } from '../src/types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accord-test-'));
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
created: "2026-02-10T10:00:00Z"
updated: "2026-02-10T10:00:00Z"
---

## What

A test request.

## Proposed Change

Add a new endpoint.
`.trimStart();

function writeRequest(inboxName: string, filename: string, content = SAMPLE_REQUEST): string {
  const dir = path.join(tmpDir, 'comms', 'inbox', inboxName);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('parseRequest', () => {
  it('parses a valid request', () => {
    const filePath = writeRequest('svc-b', 'req-001-test.md');
    const req = parseRequest(filePath);
    expect(req).not.toBeNull();
    expect(req!.frontmatter.id).toBe('req-001-test');
    expect(req!.frontmatter.status).toBe('pending');
    expect(req!.frontmatter.priority).toBe('high');
    expect(req!.serviceName).toBe('svc-b');
    expect(req!.body).toContain('A test request.');
  });

  it('returns null for invalid request (no id)', () => {
    const dir = path.join(tmpDir, 'comms', 'inbox', 'svc');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'req-bad.md');
    fs.writeFileSync(filePath, '---\nstatus: pending\n---\nbody', 'utf-8');
    const req = parseRequest(filePath);
    expect(req).toBeNull();
  });
});

describe('setRequestStatus', () => {
  it('updates status and timestamp', () => {
    const filePath = writeRequest('svc', 'req-001-test.md');
    setRequestStatus(filePath, 'in-progress');
    const req = parseRequest(filePath);
    expect(req!.frontmatter.status).toBe('in-progress');
    expect(req!.frontmatter.updated).not.toBe('2026-02-10T10:00:00Z');
  });
});

describe('updateRequestField', () => {
  it('updates an existing field', () => {
    const filePath = writeRequest('svc', 'req-001-test.md');
    updateRequestField(filePath, 'priority', 'critical');
    const req = parseRequest(filePath);
    expect(req!.frontmatter.priority).toBe('critical');
  });

  it('adds a new field', () => {
    const filePath = writeRequest('svc', 'req-001-test.md');
    updateRequestField(filePath, 'directive', 'dir-001');
    const req = parseRequest(filePath);
    expect(req!.frontmatter.directive).toBe('dir-001');
  });
});

describe('incrementAttempts', () => {
  it('increments from 0 to 1', () => {
    const filePath = writeRequest('svc', 'req-001-test.md');
    const count = incrementAttempts(filePath);
    expect(count).toBe(1);
    const req = parseRequest(filePath);
    expect(req!.frontmatter.attempts).toBe(1);
  });

  it('increments existing attempts', () => {
    const content = SAMPLE_REQUEST.replace('status: pending', 'status: pending\nattempts: 2');
    const filePath = writeRequest('svc', 'req-002.md', content);
    const count = incrementAttempts(filePath);
    expect(count).toBe(3);
  });
});

describe('archiveRequest', () => {
  it('moves file to archive directory', () => {
    const filePath = writeRequest('svc', 'req-001-test.md');
    const dest = archiveRequest(filePath, tmpDir);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.existsSync(dest)).toBe(true);
    expect(dest).toContain('archive');
  });
});

describe('appendResultSection', () => {
  it('appends result to file', () => {
    const filePath = writeRequest('svc', 'req-001-test.md');
    appendResultSection(filePath, 'All good!');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('## Result');
    expect(content).toContain('All good!');
  });
});

describe('scanInboxes', () => {
  it('finds requests across multiple service inboxes', () => {
    writeRequest('svc-a', 'req-001-foo.md');
    writeRequest('svc-b', 'req-002-bar.md');
    writeRequest('svc-b', 'req-003-baz.md');

    const config: AccordConfig = {
      version: '0.1',
      project: { name: 'test' },
      repo_model: 'monorepo',
      services: [{ name: 'svc-a' }, { name: 'svc-b' }],
    };

    const requests = scanInboxes(tmpDir, config);
    expect(requests).toHaveLength(3);
  });

  it('ignores non-request files', () => {
    const dir = path.join(tmpDir, 'comms', 'inbox', 'svc');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '# Readme', 'utf-8');
    writeRequest('svc', 'req-001.md');

    const config: AccordConfig = {
      version: '0.1',
      project: { name: 'test' },
      repo_model: 'monorepo',
      services: [{ name: 'svc' }],
    };

    const requests = scanInboxes(tmpDir, config);
    expect(requests).toHaveLength(1);
  });
});

describe('getPendingRequests', () => {
  it('filters to only pending requests', () => {
    const pending = writeRequest('svc', 'req-001.md');
    const inProgressContent = SAMPLE_REQUEST.replace('status: pending', 'status: in-progress')
      .replace('req-001-test', 'req-002-test');
    writeRequest('svc', 'req-002.md', inProgressContent);

    const config: AccordConfig = {
      version: '0.1',
      project: { name: 'test' },
      repo_model: 'monorepo',
      services: [{ name: 'svc' }],
    };

    const all = scanInboxes(tmpDir, config);
    const pendingReqs = getPendingRequests(all);
    expect(pendingReqs).toHaveLength(1);
    expect(pendingReqs[0].frontmatter.id).toBe('req-001-test');
  });
});

describe('sortByPriority', () => {
  it('sorts critical > high > medium > low', () => {
    const requests: AccordRequest[] = [
      { frontmatter: { id: 'low', priority: 'low', created: '2026-01-01T00:00:00Z' } as any, body: '', filePath: '', serviceName: '' },
      { frontmatter: { id: 'critical', priority: 'critical', created: '2026-01-01T00:00:00Z' } as any, body: '', filePath: '', serviceName: '' },
      { frontmatter: { id: 'medium', priority: 'medium', created: '2026-01-01T00:00:00Z' } as any, body: '', filePath: '', serviceName: '' },
      { frontmatter: { id: 'high', priority: 'high', created: '2026-01-01T00:00:00Z' } as any, body: '', filePath: '', serviceName: '' },
    ];

    const sorted = sortByPriority(requests);
    expect(sorted.map(r => r.frontmatter.id)).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('sorts by date within same priority (oldest first)', () => {
    const requests: AccordRequest[] = [
      { frontmatter: { id: 'newer', priority: 'high', created: '2026-02-10T00:00:00Z' } as any, body: '', filePath: '', serviceName: '' },
      { frontmatter: { id: 'older', priority: 'high', created: '2026-01-01T00:00:00Z' } as any, body: '', filePath: '', serviceName: '' },
    ];

    const sorted = sortByPriority(requests);
    expect(sorted.map(r => r.frontmatter.id)).toEqual(['older', 'newer']);
  });
});
