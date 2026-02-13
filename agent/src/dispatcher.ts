import * as path from 'node:path';
import type { AccordConfig, AccordRequest, DispatcherConfig, DispatcherStatus, RequestResult } from './types.js';
import { Worker } from './worker.js';
import { SessionManager } from './session.js';
import { createAdapter, type AgentAdapter } from './agent-adapter.js';
import { logger } from './logger.js';
import { getDependencyStatus } from './request.js';
import { syncPush, gitCommit } from './sync.js';
import { getAccordDir, getServiceDir, loadRegistryYaml } from './config.js';

export class Dispatcher {
  private workers: Worker[] = [];
  private sessionManager: SessionManager;
  private adapter: AgentAdapter;
  private config: DispatcherConfig;
  private accordConfig: AccordConfig;
  private targetDir: string;
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

    logger.info(`Dispatcher initialized: ${config.workers} workers, agent=${this.adapter.name}`);
  }

  /**
   * Dispatch a batch of pending requests to available workers.
   * Called by the Scheduler each tick.
   * Returns the number of requests processed.
   */
  async dispatch(pending: AccordRequest[], dryRun = false): Promise<number> {
    this.pendingQueue = pending.length;

    if (pending.length === 0) {
      logger.debug('No pending requests');
      return 0;
    }

    logger.info(`Dispatching: ${pending.length} pending request(s)`);

    if (dryRun) {
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

    // Assign requests to workers
    const assignments = this.assignRequests(pending);

    if (assignments.length === 0) {
      logger.debug('No workers available for assignment');
      return 0;
    }

    // Process in parallel
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

    // Commit and push any remaining changes
    if (processed > 0) {
      gitCommit(this.targetDir, `accord: dispatcher processed ${processed} request(s)`);
      syncPush(this.targetDir, this.accordConfig);
    }

    logger.debug(`Dispatch complete: processed ${processed}`);
    return processed;
  }

  get status(): DispatcherStatus {
    return {
      running: true,
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

  /** Get the underlying worker pool for route handlers. */
  getWorkers(): Worker[] {
    return this.workers;
  }

  // ── Worker assignment ────────────────────────────────────────────────────

  private assignRequests(pending: AccordRequest[]): Array<{ worker: Worker; request: AccordRequest }> {
    const assignments: Array<{ worker: Worker; request: AccordRequest }> = [];
    const accordDir = getAccordDir(this.targetDir, this.accordConfig);

    for (const request of pending) {
      const serviceName = request.serviceName;

      // Constraint 0: check depends_on_requests — skip if dependencies are unmet
      const depStatus = getDependencyStatus(request, accordDir);
      if (!depStatus.ready) {
        logger.info(`Deferred ${request.frontmatter.id}: waiting for ${depStatus.pending.join(', ')}`);
        continue;
      }

      // Constraint 0b: check maintainer type from registry (v2)
      const registry = loadRegistryYaml(accordDir, serviceName);
      if (registry) {
        if (registry.maintainer === 'human') {
          logger.debug(`Skipping ${request.frontmatter.id}: service ${serviceName} has maintainer: human`);
          continue;
        }
        if (registry.maintainer === 'hybrid' && request.frontmatter.status !== 'approved') {
          logger.debug(`Skipping ${request.frontmatter.id}: service ${serviceName} requires human approval (hybrid)`);
          continue;
        }
        if (registry.maintainer === 'external') {
          logger.debug(`Skipping ${request.frontmatter.id}: service ${serviceName} is external (owned by another team)`);
          continue;
        }
      }

      // Constraint 1: never assign two requests for the same service simultaneously
      if (this.activeServices.has(serviceName)) {
        logger.debug(`Skipping ${request.frontmatter.id}: service ${serviceName} already active`);
        continue;
      }

      // Constraint 2: never assign two requests that resolve to the same directory
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

  private findBestWorker(serviceName: string): Worker | null {
    const idleWorkers = this.workers.filter(w => w.isIdle());
    if (idleWorkers.length === 0) return null;

    // Prefer worker that last processed this service (session affinity)
    const withAffinity = idleWorkers.find(w => w.lastServiceName === serviceName);
    if (withAffinity) return withAffinity;

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
