import { describe, it, expect } from 'vitest';
import { createAdapter } from '../server/adapters/adapter.js';

describe('createAdapter', () => {
  it('creates claude-code adapter', () => {
    const adapter = createAdapter({ agent: 'claude-code' });
    expect(adapter.name).toBe('claude-code');
    expect(adapter.supportsResume).toBe(true);
  });

  it('creates shell adapter', () => {
    const adapter = createAdapter({ agent: 'shell', agent_cmd: 'echo test' });
    expect(adapter.name).toBe('shell');
    expect(adapter.supportsResume).toBe(false);
  });

  it('shell adapter defaults agent_cmd', () => {
    const adapter = createAdapter({ agent: 'shell' });
    expect(adapter.name).toBe('shell');
  });

  it('throws on unknown adapter type', () => {
    expect(() => createAdapter({ agent: 'unknown' as never }))
      .toThrow('Unknown agent adapter: unknown');
  });

  it('passes model to claude-code adapter', () => {
    const adapter = createAdapter({ agent: 'claude-code', model: 'claude-opus-4-6' });
    expect(adapter.name).toBe('claude-code');
    // Model is used internally during invoke, not exposed — just verify construction succeeds
  });
});

describe('ShellAdapter', () => {
  it('invokes shell command and returns result', async () => {
    const adapter = createAdapter({ agent: 'shell', agent_cmd: 'echo' });
    const result = await adapter.invoke({
      prompt: 'hello world',
      cwd: '/tmp',
      timeout: 10,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.sessionId).toBeUndefined();
    expect(result.costUsd).toBeUndefined();
  });

  it('throws on command failure', async () => {
    const adapter = createAdapter({ agent: 'shell', agent_cmd: 'false' });
    await expect(adapter.invoke({
      prompt: '',
      cwd: '/tmp',
      timeout: 10,
    })).rejects.toThrow('Shell agent failed');
  });
});
