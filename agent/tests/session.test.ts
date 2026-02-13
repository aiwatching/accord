import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionManager } from '../src/session.js';
import type { DispatcherConfig } from '../src/types.js';

let tmpDir: string;

function makeConfig(overrides: Partial<DispatcherConfig> = {}): DispatcherConfig {
  return {
    workers: 2,
    poll_interval: 30,
    session_max_requests: 3,
    session_max_age_hours: 1,
    request_timeout: 600,
    max_attempts: 3,
    model: 'claude-sonnet-4-5-20250929',
    debug: false,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accord-test-'));
  fs.mkdirSync(path.join(tmpDir, 'comms', 'sessions'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SessionManager', () => {
  it('creates and retrieves a session', () => {
    const sm = new SessionManager(makeConfig());
    expect(sm.getSession('svc-a')).toBeUndefined();

    sm.createSession('svc-a', 'sess-123');
    const session = sm.getSession('svc-a');
    expect(session).toBeDefined();
    expect(session!.sessionId).toBe('sess-123');
    expect(session!.requestCount).toBe(0);
  });

  it('updates session on use', () => {
    const sm = new SessionManager(makeConfig());
    sm.createSession('svc-a', 'sess-123');
    sm.updateSession('svc-a', 'sess-123');
    sm.updateSession('svc-a', 'sess-123');

    const session = sm.getSession('svc-a');
    expect(session!.requestCount).toBe(2);
  });

  it('creates session on first update if none exists', () => {
    const sm = new SessionManager(makeConfig());
    sm.updateSession('svc-a', 'sess-456');

    const session = sm.getSession('svc-a');
    expect(session).toBeDefined();
    expect(session!.sessionId).toBe('sess-456');
    expect(session!.requestCount).toBe(1);
  });

  it('rotates session after max requests', () => {
    const sm = new SessionManager(makeConfig({ session_max_requests: 2 }));
    sm.createSession('svc-a', 'sess-123');
    sm.updateSession('svc-a', 'sess-123');
    sm.updateSession('svc-a', 'sess-123');

    expect(sm.shouldRotate('svc-a')).toBe(true);

    sm.rotateSession('svc-a');
    expect(sm.getSession('svc-a')).toBeUndefined();
  });

  it('does not rotate before max requests', () => {
    const sm = new SessionManager(makeConfig({ session_max_requests: 5 }));
    sm.createSession('svc-a', 'sess-123');
    sm.updateSession('svc-a', 'sess-123');

    expect(sm.shouldRotate('svc-a')).toBe(false);
  });

  it('rotates session after max age', () => {
    const sm = new SessionManager(makeConfig({ session_max_age_hours: 0 })); // 0 hours = always rotate
    sm.createSession('svc-a', 'sess-123');
    // createdAt is Date.now(), age is ~0ms, but max is 0 hours = 0ms
    // So ageHours >= 0 should be true
    expect(sm.shouldRotate('svc-a')).toBe(true);
  });

  it('persists sessions to disk and loads them back', () => {
    const sm1 = new SessionManager(makeConfig());
    sm1.createSession('svc-a', 'sess-111');
    sm1.createSession('svc-b', 'sess-222');
    sm1.updateSession('svc-a', 'sess-111');
    sm1.saveToDisk(tmpDir);

    const sm2 = new SessionManager(makeConfig());
    sm2.loadFromDisk(tmpDir);
    expect(sm2.getSession('svc-a')).toBeDefined();
    expect(sm2.getSession('svc-a')!.sessionId).toBe('sess-111');
    expect(sm2.getSession('svc-a')!.requestCount).toBe(1);
    expect(sm2.getSession('svc-b')!.sessionId).toBe('sess-222');
  });

  it('handles missing session file gracefully', () => {
    const sm = new SessionManager(makeConfig());
    sm.loadFromDisk(tmpDir); // no file exists
    expect(sm.getSession('svc-a')).toBeUndefined();
  });

  it('writes and reads checkpoint', () => {
    const sm = new SessionManager(makeConfig());
    sm.writeCheckpoint(tmpDir, 'req-001', 'checkpoint context here');

    const checkpoint = sm.readCheckpoint(tmpDir, 'req-001');
    expect(checkpoint).toBe('checkpoint context here');
  });

  it('clears checkpoint', () => {
    const sm = new SessionManager(makeConfig());
    sm.writeCheckpoint(tmpDir, 'req-001', 'context');
    sm.clearCheckpoint(tmpDir, 'req-001');

    expect(sm.readCheckpoint(tmpDir, 'req-001')).toBeNull();
  });

  it('returns null for non-existent checkpoint', () => {
    const sm = new SessionManager(makeConfig());
    expect(sm.readCheckpoint(tmpDir, 'req-nonexistent')).toBeNull();
  });

  it('getAllSessions returns all sessions', () => {
    const sm = new SessionManager(makeConfig());
    sm.createSession('svc-a', 'sess-1');
    sm.createSession('svc-b', 'sess-2');

    const all = sm.getAllSessions();
    expect(all.size).toBe(2);
    expect(all.get('svc-a')!.sessionId).toBe('sess-1');
    expect(all.get('svc-b')!.sessionId).toBe('sess-2');
  });
});
