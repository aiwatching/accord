import { describe, it, expect, vi } from 'vitest';
import { eventBus } from '../server/event-bus.js';

describe('EventBus', () => {
  it('emits and receives typed events', () => {
    const handler = vi.fn();
    eventBus.on('request:claimed', handler);

    eventBus.emit('request:claimed', {
      requestId: 'req-001',
      service: 'svc-a',
      workerId: 0,
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      requestId: 'req-001',
      service: 'svc-a',
      workerId: 0,
    });

    eventBus.removeAllListeners('request:claimed');
  });

  it('bridges events to WebSocket send function', () => {
    const sent: string[] = [];
    const cleanup = eventBus.bridgeToWebSocket((msg) => sent.push(msg));

    eventBus.emit('scheduler:tick', {
      pendingCount: 3,
      processedCount: 1,
      timestamp: '2026-02-13T10:00:00Z',
    });

    expect(sent).toHaveLength(1);
    const parsed = JSON.parse(sent[0]);
    expect(parsed.type).toBe('scheduler:tick');
    expect(parsed.data.pendingCount).toBe(3);
    expect(parsed.timestamp).toBeDefined();

    cleanup();
  });

  it('cleanup removes listeners', () => {
    const sent: string[] = [];
    const cleanup = eventBus.bridgeToWebSocket((msg) => sent.push(msg));

    cleanup();

    eventBus.emit('sync:pull', { direction: 'pull', success: true });
    expect(sent).toHaveLength(0);
  });

  it('handles send errors gracefully', () => {
    const cleanup = eventBus.bridgeToWebSocket(() => {
      throw new Error('socket closed');
    });

    // Should not throw
    expect(() => {
      eventBus.emit('sync:push', { direction: 'push', success: true });
    }).not.toThrow();

    cleanup();
  });
});
