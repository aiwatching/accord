import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { executeCommand, isValidCommand } from '../server/commands.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accord-test-'));
  // Create .accord structure
  fs.mkdirSync(path.join(tmpDir, 'contracts', 'internal'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'comms', 'inbox', 'svc-a'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'comms', 'inbox', 'svc-b'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'comms', 'archive'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('isValidCommand', () => {
  it('accepts valid commands', () => {
    expect(isValidCommand('status')).toBe(true);
    expect(isValidCommand('scan')).toBe(true);
    expect(isValidCommand('check-inbox')).toBe(true);
    expect(isValidCommand('validate')).toBe(true);
  });

  it('rejects invalid commands', () => {
    expect(isValidCommand('exec')).toBe(false);
    expect(isValidCommand('rm -rf')).toBe(false);
    expect(isValidCommand('')).toBe(false);
  });
});

describe('executeCommand', () => {
  it('status: counts contracts and inbox items', () => {
    // Create some contracts
    fs.writeFileSync(path.join(tmpDir, 'contracts', 'svc-a.yaml'), 'openapi: "3.0"', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'contracts', 'svc-b.yaml'), 'openapi: "3.0"', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'contracts', 'internal', 'mod-a.md'), '# mod-a', 'utf-8');

    // Create inbox items
    fs.writeFileSync(
      path.join(tmpDir, 'comms', 'inbox', 'svc-a', 'req-001.md'),
      '---\nstatus: pending\n---\ntest',
      'utf-8',
    );

    // Create archive items
    fs.writeFileSync(
      path.join(tmpDir, 'comms', 'archive', 'req-old.md'),
      '---\nstatus: completed\n---\ndone',
      'utf-8',
    );

    const result = executeCommand('status', tmpDir, tmpDir);
    expect(result).toContain('2 external');
    expect(result).toContain('1 internal');
    expect(result).toContain('1'); // inbox
    expect(result).toContain('1'); // archived
  });

  it('check-inbox: lists requests as markdown table', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'comms', 'inbox', 'svc-a', 'req-001-foo.md'),
      '---\nid: req-001-foo\nstatus: pending\npriority: high\ntype: api-addition\n---\ntest',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'comms', 'inbox', 'svc-b', 'req-002-bar.md'),
      '---\nid: req-002-bar\nstatus: in-progress\npriority: medium\ntype: bug-report\n---\ntest',
      'utf-8',
    );

    const result = executeCommand('check-inbox', tmpDir, tmpDir);
    expect(result).toContain('svc-a');
    expect(result).toContain('svc-b');
    expect(result).toContain('pending');
    expect(result).toContain('in-progress');
    expect(result).toContain('req-001-foo');
    expect(result).toContain('req-002-bar');
  });

  it('check-inbox: returns message when no inbox exists', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accord-test-empty-'));
    const result = executeCommand('check-inbox', emptyDir, emptyDir);
    expect(result).toContain('No inbox');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('returns error for unknown command', () => {
    const result = executeCommand('evil-cmd', tmpDir, tmpDir);
    expect(result).toContain('ERROR');
    expect(result).toContain('Unknown command');
  });
});
