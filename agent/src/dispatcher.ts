import * as path from 'node:path';
import type { AccordConfig, AccordRequest, DispatcherConfig, DispatcherStatus, RequestResult } from './types.js';
import { Worker } from './worker.js';
import { SessionManager } from './session.js';
import { createAdapter, type AgentAdapter } from './agent-adapter.js';
import { logger } from './logger.js';
import { scanInboxes, getPendingRequests, sortByPriority } from './request.js';
import { syncPull, syncPush, gitCommit } from './sync.js';
import { getAccordDir, getServiceDir } from './config.js';

export class Dispatcher {
  private workers: Worker[] = [];
  private sessionManager: SessionManager;
  private adapter: AgentAdapter;
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
  // Track which directories are in use — prevents concurrent access to same cwd
  private activeDirectories = new Set<string>();

  constructor(
    config: DispatcherConfig,
    accordConfig: AccordConfig,
    targetDir: string,
  ) {
    this.config = config;
    this.accordConfig = accordConfig;
    this.targetDir = targetDir;
    this.sessionManager = new SessionManager(config);

    // Create agent adapter
    this.adapter = createAdapter({
      agent: config.agent,
      agent_cmd: config.agent_cmd,
      model: config.model,
    });

    // Load sessions from disk for resume (only meaningful for adapters that support it)
    const accordDir = getAccordDir(targetDir, accordConfig);
    if (this.adapter.supportsResume) {
      this.sessionManager.loadFromDisk(accordDir);
    }

    // Create worker pool
    for (let i = 0; i < config.workers; i++) {
      this.workers.push(new Worker(i, config, accordConfig, this.sessionManager, this.adapter, targetDir));
    }

    logger.info(`Dispatcher initialized: ${config.workers} workers, agent=${this.adapter.name}, poll interval ${config.poll_interval}s`);
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
      // Show what would be assigned (respects directory constraint)
      const assignments = this.assignRequests(pending);
      const skipped = pending.length - assignments.length;
      for (const { worker, request } of assignments) {
        logger.info(`  [dry-run] ${request.frontmatter.id} → ${request.serviceName} (${request.frontmatter.priority}) → worker ${worker.id}`);
      }
      if (skipped > 0) {
        logger.info(`  [dry-run] ${skipped} request(s) deferred (directory/service constraint)`);
      }
      // Clean up: release active services/directories since we didn't actually process
      for (const { request } of assignments) {
        const serviceDir = path.resolve(getServiceDir(this.accordConfig, request.serviceName, this.targetDir));
        this.activeServices.delete(request.serviceName);
        this.activeDirectories.delete(serviceDir);
      }
      return assignments.length;
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

      // Constraint 1: never assign two requests for the same service simultaneously
      if (this.activeServices.has(serviceName)) {
        logger.debug(`Skipping ${request.frontmatter.id}: service ${serviceName} already active`);
        continue;
      }

      // Constraint 2: never assign two requests that resolve to the same directory
      // (critical for monorepo where all services share one cwd)
      const serviceDir = path.resolve(getServiceDir(this.accordConfig, serviceName, this.targetDir));
      if (this.activeDirectories.has(serviceDir)) {
        logger.debug(`Skipping ${request.frontmatter.id}: directory ${serviceDir} already in use by another service`);
        continue;
      }

      const worker = this.findBestWorker(serviceName);
      if (!worker) {
        logger.debug(`No idle worker for ${request.frontmatter.id}`);
        continue;
      }

      assignments.push({ worker, request });
      this.activeServices.add(serviceName);
      this.activeDirectories.add(serviceDir);
    }

    return assignments;
  }

  /**
   * Find the best idle worker for a given service:
   * 1. Best: idle worker that last processed this service (session affinity)
   * 2. Good: any idle worker (first available)
   */
  private findBestWorker(serviceName: string): Worker | null {
    const idleWorkers = this.workers.filter(w => w.isIdle());
    if (idleWorkers.length === 0) return null;

    // Prefer worker that last processed this service (true session affinity)
    const withAffinity = idleWorkers.find(w => w.lastServiceName === serviceName);
    if (withAffinity) return withAffinity;

    // Otherwise, pick any idle worker
    return idleWorkers[0];
  }

  private async processWithWorker(worker: Worker, request: AccordRequest): Promise<RequestResult> {
    const serviceName = request.serviceName;
    const serviceDir = path.resolve(getServiceDir(this.accordConfig, serviceName, this.targetDir));
    try {
      return await worker.processRequest(request);
    } finally {
      this.activeServices.delete(serviceName);
      this.activeDirectories.delete(serviceDir);
    }
  }
}
