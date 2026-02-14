import type { AccordConfig } from './types.js';
import type { Dispatcher } from './dispatcher.js';
import { eventBus } from './event-bus.js';
import { syncPull } from './git-sync.js';
import { scanInboxes, getDispatchableRequests, sortByPriority } from './scanner.js';
import { loadConfig, getAccordDir } from './config.js';
import { setHubState, getHubState } from './hub-state.js';
import { logger } from './logger.js';

export class Scheduler {
  private dispatcher: Dispatcher;
  private config: AccordConfig;
  private hubDir: string;
  private intervalSec: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private ticking = false;
  private lastTickTime: string | null = null;

  constructor(dispatcher: Dispatcher, config: AccordConfig, hubDir: string, intervalSec: number) {
    this.dispatcher = dispatcher;
    this.config = config;
    this.hubDir = hubDir;
    this.intervalSec = intervalSec;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    logger.info(`Scheduler started — polling every ${this.intervalSec}s`);

    // Run immediately, then on interval
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalSec * 1000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('Scheduler stopped');
  }

  /** Trigger an immediate tick (for API-driven manual sync). */
  async triggerNow(): Promise<number> {
    return this.tick();
  }

  get status() {
    return {
      running: this.running,
      lastTickTime: this.lastTickTime,
      intervalSec: this.intervalSec,
    };
  }

  /** Re-read config.yaml from disk. Detects new/removed services. */
  private reloadConfig(): void {
    try {
      const fresh = loadConfig(this.hubDir);
      const oldNames = this.config.services.map(s => s.name).sort().join(',');
      const newNames = fresh.services.map(s => s.name).sort().join(',');
      if (oldNames !== newNames) {
        logger.info(`Config changed: services [${oldNames}] → [${newNames}]`);
        this.config = fresh;
        // Update shared hub state so API routes also see the new config
        const state = getHubState();
        setHubState({ ...state, config: fresh });
      }
    } catch (err) {
      logger.warn(`Config reload failed (using cached): ${err}`);
    }
  }

  private async tick(): Promise<number> {
    if (this.ticking) {
      logger.debug('Scheduler: tick already in progress, skipping');
      return 0;
    }

    this.ticking = true;
    try {
      logger.debug('--- Scheduler tick ---');

      // 0. Hot-reload config from disk (picks up new services added by orchestrator)
      this.reloadConfig();

      // 1. Sync pull
      syncPull(this.hubDir, this.config);
      eventBus.emit('sync:pull', { direction: 'pull', success: true });

      // 2. Scan inboxes (pass hubDir for multi-team support)
      const accordDir = getAccordDir(this.hubDir, this.config);
      const allRequests = scanInboxes(accordDir, this.config, this.hubDir);
      const pending = sortByPriority(getDispatchableRequests(allRequests));

      // 3. Dispatch
      const processed = await this.dispatcher.dispatch(pending);

      this.lastTickTime = new Date().toISOString();

      eventBus.emit('scheduler:tick', {
        pendingCount: pending.length,
        processedCount: processed,
        timestamp: this.lastTickTime,
      });

      return processed;
    } catch (err) {
      logger.error(`Scheduler tick error: ${err}`);
      return 0;
    } finally {
      this.ticking = false;
    }
  }
}
