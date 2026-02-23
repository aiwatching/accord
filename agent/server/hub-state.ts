// Shared state accessible across the hub service.
// Set by index.ts after initialization, consumed by route handlers.

import type { AccordConfig, DispatcherConfig } from './types.js';
import type { Dispatcher } from './dispatcher.js';
import type { OrchestratorCoordinator } from './orchestrator.js';
import { getAccordDir } from './config.js';
import { scanInboxes, getDispatchableRequests, sortByPriority } from './scanner.js';
import { logger } from './logger.js';

interface HubState {
  hubDir: string;
  config: AccordConfig;
  dispatcherConfig: DispatcherConfig;
  dispatcher: Dispatcher;
  coordinator?: OrchestratorCoordinator;
}

let state: HubState | null = null;
let dispatching = false;

export function setHubState(s: HubState): void {
  state = s;
}

export function getHubState(): HubState {
  if (!state) throw new Error('Hub state not initialized');
  return state;
}

/**
 * Scan for pending requests and dispatch them via A2A.
 * Safe to call frequently — skips if already dispatching.
 */
export async function triggerDispatch(): Promise<number> {
  if (!state) return 0;
  if (dispatching) return 0;
  dispatching = true;

  try {
    const { config, hubDir, dispatcher } = state;
    const accordDir = getAccordDir(hubDir, config);
    const allRequests = scanInboxes(accordDir, config, hubDir);
    const pending = sortByPriority(getDispatchableRequests(allRequests));
    if (pending.length === 0) return 0;

    const count = await dispatcher.dispatch(pending);
    if (count > 0) {
      logger.info(`triggerDispatch: dispatched ${count} request(s)`);
    }
    return count;
  } catch (err) {
    logger.error(`triggerDispatch error: ${err}`);
    return 0;
  } finally {
    dispatching = false;
  }
}
