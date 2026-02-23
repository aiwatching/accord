// Shared state accessible across the hub service.
// Set by index.ts after initialization, consumed by route handlers.

import type { AccordConfig, DispatcherConfig } from './types.js';
import type { Dispatcher } from './dispatcher.js';

interface HubState {
  hubDir: string;
  config: AccordConfig;
  dispatcherConfig: DispatcherConfig;
  dispatcher: Dispatcher;
}

let state: HubState | null = null;

export function setHubState(s: HubState): void {
  state = s;
}

export function getHubState(): HubState {
  if (!state) throw new Error('Hub state not initialized');
  return state;
}
