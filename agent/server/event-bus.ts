import { EventEmitter } from 'node:events';
import type { RequestResult, DirectivePhase } from './types.js';
import type { StreamEvent } from './adapters/adapter.js';

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
  /** Request type from frontmatter (e.g. 'contract-proposal', 'integration-test', 'fix') */
  requestType?: string;
}

export interface RequestFailedEvent {
  requestId: string;
  service: string;
  workerId: number;
  error: string;
  willRetry: boolean;
  /** Request type from frontmatter (e.g. 'contract-proposal', 'integration-test', 'fix') */
  requestType?: string;
}

export interface SyncEvent {
  direction: 'pull' | 'push';
  success: boolean;
  error?: string;
}

export interface SessionStartEvent {
  service: string;
  message: string;
}

export interface SessionOutputEvent {
  service: string;
  chunk: string;
  streamIndex: number;
  /** Structured stream event (when available from SDK adapter). */
  event?: StreamEvent;
}

export interface SessionCompleteEvent {
  service: string;
  durationMs: number;
  costUsd?: number;
  numTurns?: number;
}

export interface SessionErrorEvent {
  service: string;
  error: string;
}

export interface SessionPlanGeneratingEvent {
  service: string;
  message: string;
}

export interface SessionPlanReadyEvent {
  service: string;
  plan: string;
  costUsd?: number;
}

export interface SessionPlanCanceledEvent {
  service: string;
}

export interface SessionPlanTimeoutEvent {
  service: string;
}

export interface ServiceAddedEvent {
  name: string;
  type: string;
  directory?: string;
  repo?: string;
}

export interface ServiceRemovedEvent {
  name: string;
}

// ── A2A event types ─────────────────────────────────────────────────────────

export interface A2AStatusUpdateEvent {
  requestId: string;
  service: string;
  taskId: string;
  contextId: string;
  state: string; // 'working' | 'input-required' | 'completed' | 'failed' | 'canceled'
  message?: string;
}

export interface A2AArtifactUpdateEvent {
  requestId: string;
  service: string;
  taskId: string;
  artifactName: string;
  artifactData: unknown;
}

// ── Directive coordination events ────────────────────────────────────────────

export interface DirectivePhaseChangeEvent {
  directiveId: string;
  fromPhase: DirectivePhase;
  toPhase: DirectivePhase;
  message?: string;
}

export interface ContractNegotiationEvent {
  directiveId: string;
  contractPath: string;
  service: string;
  action: 'proposed' | 'accepted' | 'rejected' | 'overridden';
  reason?: string;
}

export interface TestResultEvent {
  directiveId: string;
  testRequestId: string;
  passed: boolean;
  details?: string;
}

// ── Event map ────────────────────────────────────────────────────────────────

export interface EventMap {
  'request:claimed': RequestClaimedEvent;
  'request:completed': RequestCompletedEvent;
  'request:failed': RequestFailedEvent;
  'sync:pull': SyncEvent;
  'sync:push': SyncEvent;
  'session:start': SessionStartEvent;
  'session:output': SessionOutputEvent;
  'session:complete': SessionCompleteEvent;
  'session:error': SessionErrorEvent;
  'session:plan-generating': SessionPlanGeneratingEvent;
  'session:plan-ready': SessionPlanReadyEvent;
  'session:plan-canceled': SessionPlanCanceledEvent;
  'session:plan-timeout': SessionPlanTimeoutEvent;
  'service:added': ServiceAddedEvent;
  'service:removed': ServiceRemovedEvent;
  'a2a:status-update': A2AStatusUpdateEvent;
  'a2a:artifact-update': A2AArtifactUpdateEvent;
  'directive:phase-change': DirectivePhaseChangeEvent;
  'directive:contract-negotiation': ContractNegotiationEvent;
  'directive:test-result': TestResultEvent;
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
      'sync:pull', 'sync:push',
      'session:start', 'session:output', 'session:complete', 'session:error',
      'session:plan-generating', 'session:plan-ready', 'session:plan-canceled', 'session:plan-timeout',
      'service:added', 'service:removed',
      'a2a:status-update', 'a2a:artifact-update',
      'directive:phase-change', 'directive:contract-negotiation', 'directive:test-result',
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

    return () => {
      for (const [name, handler] of handlers) {
        this.removeListener(name, handler);
      }
    };
  }
}

export const eventBus = new AccordEventBus();
