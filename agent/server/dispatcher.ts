import * as path from 'node:path';
import type { AccordConfig, AccordRequest, DispatcherConfig, DispatcherStatus, RequestResult } from './types.js';
import { Worker } from './worker-pool.js';
import { SessionManager } from './session-manager.js';
import { createAdapter, type AgentAdapter } from './adapters/adapter.js';
import { logger } from './logger.js';
import { getDependencyStatus } from './scanner.js';
import { syncPush, gitCommit } from './git-sync.js';
import { getAccordDir, getServiceDir, getServiceConfig, loadRegistryYaml } from './config.js';
import { AccordA2AClient, type A2AStreamEvent } from './a2a/client.js';
import { eventBus } from './event-bus.js';

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
  // A2A client for remote service dispatch
  private a2aClient = new AccordA2AClient();

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

    // Split A2A and Worker assignments
    const a2aAssignments = assignments.filter(a => this.getA2AUrl(a.request) !== undefined);
    const workerAssignments = assignments.filter(a => this.getA2AUrl(a.request) === undefined);

    // A2A path: dispatch via A2A Client (fire-and-forget, events via SSE callback)
    for (const { request } of a2aAssignments) {
      this.processViaA2A(request);
    }

    // Worker path: existing logic unchanged
    const promises = workerAssignments.map(({ worker, request }) =>
      this.processWithWorker(worker, request)
    );

    const results = await Promise.allSettled(promises);
    let processed = a2aAssignments.length; // A2A dispatches count as processed

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

    // Commit and push any remaining changes (worker path only)
    if (workerAssignments.length > 0 && processed > a2aAssignments.length) {
      gitCommit(this.targetDir, `accord: dispatcher processed ${processed - a2aAssignments.length} request(s)`);
      syncPush(this.targetDir, this.accordConfig);
    }

    logger.debug(`Dispatch complete: processed ${processed} (${a2aAssignments.length} via A2A, ${workerAssignments.length} via worker)`);
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

  /** Expose adapter for direct session invocation (console → orchestrator). */
  getAdapter(): AgentAdapter {
    return this.adapter;
  }

  /** Expose session manager for direct session invocation. */
  getSessionManager(): SessionManager {
    return this.sessionManager;
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

  // ── A2A dispatch ──────────────────────────────────────────────────────────

  /**
   * Get the A2A URL for a request's target service, if configured.
   * Checks ServiceConfig.a2a_url first, then RegistryYaml.a2a_url.
   */
  private getA2AUrl(request: AccordRequest): string | undefined {
    const serviceName = request.serviceName;

    // Check ServiceConfig first
    const svcConfig = getServiceConfig(this.accordConfig, serviceName);
    if (svcConfig?.a2a_url) {
      return svcConfig.a2a_url;
    }

    // Check RegistryYaml
    const accordDir = getAccordDir(this.targetDir, this.accordConfig);
    const registry = loadRegistryYaml(accordDir, serviceName);
    if (registry?.a2a_url) {
      return registry.a2a_url;
    }

    return undefined;
  }

  /**
   * Process a request via A2A Client (fire-and-forget).
   * Listens to SSE events and maps them to the event bus.
   */
  private async processViaA2A(request: AccordRequest): Promise<void> {
    const serviceName = request.serviceName;
    const serviceDir = path.resolve(getServiceDir(this.accordConfig, serviceName, this.targetDir));
    const a2aUrl = this.getA2AUrl(request)!;
    const requestId = request.frontmatter.id;

    logger.info(`A2A dispatch: ${requestId} → ${serviceName} via ${a2aUrl}`);

    try {
      let taskId = '';
      let contextId = '';

      for await (const event of this.a2aClient.sendRequest(a2aUrl, request)) {
        // Extract taskId and contextId from Task events
        if ('kind' in event && event.kind === 'task') {
          const task = event as import('@a2a-js/sdk').Task;
          taskId = task.id;
          contextId = task.contextId;
        }

        // Handle TaskStatusUpdateEvent
        if ('kind' in event && event.kind === 'status-update') {
          const statusEvent = event as import('@a2a-js/sdk').TaskStatusUpdateEvent;
          taskId = statusEvent.taskId;
          contextId = statusEvent.contextId;
          const state = statusEvent.status.state;
          const message = statusEvent.status.message?.parts
            ?.filter((p): p is import('@a2a-js/sdk').TextPart => p.kind === 'text')
            .map(p => p.text)
            .join('') ?? '';

          eventBus.emit('a2a:status-update', {
            requestId,
            service: serviceName,
            taskId,
            contextId,
            state,
            message,
          });

          if (state === 'working') {
            eventBus.emit('request:claimed', {
              requestId,
              service: serviceName,
              workerId: -1, // A2A dispatch, no local worker
            });
          } else if (state === 'completed') {
            // Extract contract updates from the final task
            try {
              const finalTask = await this.a2aClient.getTask(a2aUrl, taskId);
              const contractUpdates = this.a2aClient.extractContractUpdates(finalTask);
              for (const update of contractUpdates) {
                eventBus.emit('a2a:artifact-update', {
                  requestId,
                  service: serviceName,
                  taskId,
                  artifactName: 'contract-update',
                  artifactData: update,
                });
              }
            } catch (err) {
              logger.warn(`A2A: Failed to extract contract updates for ${requestId}: ${err}`);
            }

            this.totalProcessed += 1;
            eventBus.emit('request:completed', {
              requestId,
              service: serviceName,
              workerId: -1,
              result: {
                requestId,
                success: true,
                durationMs: 0,
                completedAt: new Date().toISOString(),
              },
            });
          } else if (state === 'failed' || state === 'canceled') {
            this.totalProcessed += 1;
            this.totalFailed += 1;
            eventBus.emit('request:failed', {
              requestId,
              service: serviceName,
              workerId: -1,
              error: message || `A2A task ${state}`,
              willRetry: false,
            });
          }
        }

        // Handle TaskArtifactUpdateEvent
        if ('kind' in event && event.kind === 'artifact-update') {
          const artifactEvent = event as import('@a2a-js/sdk').TaskArtifactUpdateEvent;
          eventBus.emit('a2a:artifact-update', {
            requestId,
            service: serviceName,
            taskId: artifactEvent.taskId,
            artifactName: artifactEvent.artifact.name ?? 'unnamed',
            artifactData: artifactEvent.artifact,
          });
        }
      }
    } catch (err) {
      logger.error(`A2A dispatch failed for ${requestId}: ${err}`);
      this.totalProcessed += 1;
      this.totalFailed += 1;
      eventBus.emit('request:failed', {
        requestId,
        service: serviceName,
        workerId: -1,
        error: `A2A dispatch error: ${err}`,
        willRetry: false,
      });
    } finally {
      this.activeServices.delete(serviceName);
      this.activeDirectories.delete(serviceDir);
    }
  }
}
