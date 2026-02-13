import type { AccordConfig } from './types.js';
import type { Dispatcher } from './dispatcher.js';
import { eventBus } from './event-bus.js';
import { syncPull } from './sync.js';
import { scanInboxes, getPendingRequests, sortByPriority } from './request.js';
import { getAccordDir } from './config.js';
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

  private async tick(): Promise<number> {
    if (this.ticking) {
      logger.debug('Scheduler: tick already in progress, skipping');
      return 0;
    }

    this.ticking = true;
    try {
      logger.debug('--- Scheduler tick ---');

      // 1. Sync pull
      syncPull(this.hubDir, this.config);
      eventBus.emit('sync:pull', { direction: 'pull', success: true });

      // 2. Scan inboxes
      const accordDir = getAccordDir(this.hubDir, this.config);
      const allRequests = scanInboxes(accordDir, this.config);
      const pending = sortByPriority(getPendingRequests(allRequests));

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
