import type { AccordConfig, AccordRequest, DispatcherConfig, DispatcherStatus, RequestResult } from './types.js';
import { Worker } from './worker.js';
import { SessionManager } from './session.js';
import { logger } from './logger.js';
import { scanInboxes, getPendingRequests, sortByPriority } from './request.js';
import { syncPull, syncPush, gitCommit } from './sync.js';
import { getAccordDir } from './config.js';

export class Dispatcher {
  private workers: Worker[] = [];
  private sessionManager: SessionManager;
  private config: DispatcherConfig;
  private accordConfig: AccordConfig;
  private targetDir: string;
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private totalProcessed = 0;
  private totalFailed = 0;
  private pendingQueue = 0;
  // Track which services have a worker actively processing
  private activeServices = new Set<string>();

  constructor(
    config: DispatcherConfig,
    accordConfig: AccordConfig,
    targetDir: string,
  ) {
    this.config = config;
    this.accordConfig = accordConfig;
    this.targetDir = targetDir;
    this.sessionManager = new SessionManager(config);

    // Load sessions from disk for resume
    const accordDir = getAccordDir(targetDir, accordConfig);
    this.sessionManager.loadFromDisk(accordDir);

    // Create worker pool
    for (let i = 0; i < config.workers; i++) {
      this.workers.push(new Worker(i, config, accordConfig, this.sessionManager, targetDir));
    }

    logger.info(`Dispatcher initialized: ${config.workers} workers, poll interval ${config.poll_interval}s`);
  }

  async start(intervalOverride?: number): Promise<void> {
    if (this.running) {
      logger.warn('Dispatcher is already running');
      return;
    }

    this.running = true;
    const pollInterval = (intervalOverride ?? this.config.poll_interval) * 1000;

    logger.info('Dispatcher starting...');

    // Run immediately, then on interval
    await this.tick();

    this.interval = setInterval(async () => {
      if (!this.running) return;
      try {
        await this.tick();
      } catch (err) {
        logger.error(`Tick error: ${err}`);
      }
    }, pollInterval);
  }

  stop(): void {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info('Dispatcher stopped');
  }

  async runOnce(dryRun = false): Promise<number> {
    return await this.tick(dryRun);
  }

  get status(): DispatcherStatus {
    return {
      running: this.running,
      workers: this.workers.map(w => ({
        workerId: w.id,
        state: w.status.state,
        currentRequest: w.status.currentRequest,
        sessions: this.sessionManager.getAllSessions(),
      })),
      pendingQueue: this.pendingQueue,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
    };
  }

  // ── Core tick cycle ──────────────────────────────────────────────────────

  private async tick(dryRun = false): Promise<number> {
    logger.debug('--- Tick start ---');

    // 1. Sync pull
    if (!dryRun) {
      syncPull(this.targetDir, this.accordConfig);
    }

    // 2. Scan inboxes
    const accordDir = getAccordDir(this.targetDir, this.accordConfig);
    const allRequests = scanInboxes(accordDir, this.accordConfig);
    const pending = sortByPriority(getPendingRequests(allRequests));
    this.pendingQueue = pending.length;

    if (pending.length === 0) {
      logger.debug('No pending requests');
      return 0;
    }

    logger.info(`Found ${pending.length} pending request(s)`);

    if (dryRun) {
      for (const req of pending) {
        logger.info(`  [dry-run] ${req.frontmatter.id} → ${req.serviceName} (${req.frontmatter.priority})`);
      }
      return pending.length;
    }

    // 3. Assign requests to workers
    const assignments = this.assignRequests(pending);

    if (assignments.length === 0) {
      logger.debug('No workers available for assignment');
      return 0;
    }

    // 4. Process in parallel
    const promises = assignments.map(({ worker, request }) =>
      this.processWithWorker(worker, request)
    );

    const results = await Promise.allSettled(promises);
    let processed = 0;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const r = result.value;
        this.totalProcessed += 1;
        if (!r.success) this.totalFailed += 1;
        processed += 1;
      } else {
        this.totalFailed += 1;
        logger.error(`Worker failed: ${result.reason}`);
      }
    }

    // 5. Commit and push any remaining changes
    if (processed > 0) {
      gitCommit(this.targetDir, `accord: dispatcher processed ${processed} request(s)`);
      syncPush(this.targetDir, this.accordConfig);
    }

    logger.debug(`--- Tick end: processed ${processed} ---`);
    return processed;
  }

  // ── Worker assignment ────────────────────────────────────────────────────

  private assignRequests(pending: AccordRequest[]): Array<{ worker: Worker; request: AccordRequest }> {
    const assignments: Array<{ worker: Worker; request: AccordRequest }> = [];

    for (const request of pending) {
      const serviceName = request.serviceName;

      // Constraint: never assign two requests for the same service simultaneously
      if (this.activeServices.has(serviceName)) {
        logger.debug(`Skipping ${request.frontmatter.id}: service ${serviceName} already active`);
        continue;
      }

      const worker = this.findBestWorker(serviceName);
      if (!worker) {
        logger.debug(`No idle worker for ${request.frontmatter.id}`);
        continue;
      }

      assignments.push({ worker, request });
      this.activeServices.add(serviceName);
    }

    return assignments;
  }

  /**
   * Find the best idle worker for a given service:
   * 1. Best: idle worker with existing session for this service (session affinity)
   * 2. Good: idle worker with fewest sessions (load balance)
   */
  private findBestWorker(serviceName: string): Worker | null {
    const idleWorkers = this.workers.filter(w => w.isIdle());
    if (idleWorkers.length === 0) return null;

    // Prefer worker with existing session for this service
    const withSession = idleWorkers.find(w => w.hasSessionFor(serviceName));
    if (withSession) return withSession;

    // Otherwise, pick the one with fewest active sessions
    return idleWorkers[0];
  }

  private async processWithWorker(worker: Worker, request: AccordRequest): Promise<RequestResult> {
    const serviceName = request.serviceName;
    try {
      return await worker.processRequest(request);
    } finally {
      this.activeServices.delete(serviceName);
    }
  }
}
