import { EventEmitter } from 'node:events';
import type { AccordRequest, RequestResult, WorkerState } from './types.js';

// ── Event payload types ─────────────────────────────────────────────────────

export interface RequestClaimedEvent {
  requestId: string;
  service: string;
  workerId: number;
}

export interface RequestCompletedEvent {
  requestId: string;
  service: string;
  workerId: number;
  result: RequestResult;
}

export interface RequestFailedEvent {
  requestId: string;
  service: string;
  workerId: number;
  error: string;
  willRetry: boolean;
}

export interface WorkerStartedEvent {
  workerId: number;
  service: string;
  requestId: string;
}

export interface WorkerOutputEvent {
  workerId: number;
  service: string;
  requestId: string;
  chunk: string;
  streamIndex: number;
}

export interface WorkerFinishedEvent {
  workerId: number;
  service: string;
  requestId: string;
  success: boolean;
}

export interface SyncEvent {
  direction: 'pull' | 'push';
  success: boolean;
  error?: string;
}

export interface SchedulerTickEvent {
  pendingCount: number;
  processedCount: number;
  timestamp: string;
}

// ── Event map ────────────────────────────────────────────────────────────────

export interface EventMap {
  'request:claimed': RequestClaimedEvent;
  'request:completed': RequestCompletedEvent;
  'request:failed': RequestFailedEvent;
  'worker:started': WorkerStartedEvent;
  'worker:output': WorkerOutputEvent;
  'worker:finished': WorkerFinishedEvent;
  'sync:pull': SyncEvent;
  'sync:push': SyncEvent;
  'scheduler:tick': SchedulerTickEvent;
}

export type EventName = keyof EventMap;

// ── Wire format for WebSocket ────────────────────────────────────────────────

export interface WireMessage {
  type: EventName;
  data: EventMap[EventName];
  timestamp: string;
}

// ── Typed Event Bus ──────────────────────────────────────────────────────────

class AccordEventBus extends EventEmitter {
  constructor() {
    super();
    // Each WebSocket client adds 9 listeners (one per event type).
    // Default limit of 10 triggers warnings with just 2 clients.
    this.setMaxListeners(100);
  }

  emit<K extends EventName>(event: K, data: EventMap[K]): boolean {
    return super.emit(event, data);
  }

  on<K extends EventName>(event: K, listener: (data: EventMap[K]) => void): this {
    return super.on(event, listener);
  }

  /**
   * Bridge all events to a WebSocket send function.
   * Returns a cleanup function to call when the socket disconnects.
   */
  bridgeToWebSocket(send: (msg: string) => void): () => void {
    const eventNames: EventName[] = [
      'request:claimed', 'request:completed', 'request:failed',
      'worker:started', 'worker:output', 'worker:finished',
      'sync:pull', 'sync:push', 'scheduler:tick',
    ];

    const handlers = new Map<string, (...args: unknown[]) => void>();

    for (const name of eventNames) {
      const handler = (data: unknown) => {
        const msg: WireMessage = {
          type: name,
          data: data as EventMap[typeof name],
          timestamp: new Date().toISOString(),
        };
        try {
          send(JSON.stringify(msg));
        } catch {
          // Socket might be closed — ignore
        }
      };
      handlers.set(name, handler);
      this.on(name as EventName, handler as (data: EventMap[EventName]) => void);
    }

    // Return cleanup function
    return () => {
      for (const [name, handler] of handlers) {
        this.removeListener(name, handler);
      }
    };
  }
}

export const eventBus = new AccordEventBus();
