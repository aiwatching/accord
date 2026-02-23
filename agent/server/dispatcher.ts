import * as path from 'node:path';
import type { AccordConfig, AccordRequest, DispatcherConfig, DispatcherStatus } from './types.js';
import { SessionManager } from './session-manager.js';
import { createAdapter, type AgentAdapter } from './adapters/adapter.js';
import { logger } from './logger.js';
import { getDependencyStatus } from './scanner.js';
import { getAccordDir, getServiceDir, getServiceConfig, loadRegistryYaml } from './config.js';
import { AccordA2AClient } from './a2a/client.js';
import { eventBus } from './event-bus.js';

export class Dispatcher {
  private adapter: AgentAdapter;
  private sessionManager: SessionManager;
  private config: DispatcherConfig;
  private accordConfig: AccordConfig;
  private targetDir: string;
  private totalProcessed = 0;
  private totalFailed = 0;
  private pendingQueue = 0;
  // Track which services have an active A2A dispatch
  private activeServices = new Set<string>();
  // Track which directories are in use
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

    // Create agent adapter (used by orchestrator console + service executor)
    this.adapter = createAdapter({
      agent: config.agent,
      agent_cmd: config.agent_cmd,
      model: config.model,
    });

    // Load sessions from disk for resume
    const accordDir = getAccordDir(targetDir, accordConfig);
    if (this.adapter.supportsResume) {
      this.sessionManager.loadFromDisk(accordDir);
    }

    logger.info(`Dispatcher initialized: A2A-only mode, agent=${this.adapter.name}`);
  }

  /**
   * Dispatch a batch of pending requests via A2A.
   * Returns the number of requests dispatched.
   */
  async dispatch(pending: AccordRequest[], dryRun = false): Promise<number> {
    this.pendingQueue = pending.length;

    if (pending.length === 0) {
      logger.debug('No pending requests');
      return 0;
    }

    logger.info(`Dispatching: ${pending.length} pending request(s)`);

    // Filter requests through constraint checks
    const assignments = this.filterAssignable(pending);

    if (dryRun) {
      const skipped = pending.length - assignments.length;
      for (const request of assignments) {
        const a2aUrl = this.getA2AUrl(request);
        logger.info(`  [dry-run] ${request.frontmatter.id} → ${request.serviceName} (${request.frontmatter.priority}) via ${a2aUrl ?? 'no a2a_url'}`);
      }
      if (skipped > 0) {
        logger.info(`  [dry-run] ${skipped} request(s) deferred (constraint/no a2a_url)`);
      }
      // Clean up active tracking
      for (const request of assignments) {
        const serviceDir = path.resolve(getServiceDir(this.accordConfig, request.serviceName, this.targetDir));
        this.activeServices.delete(request.serviceName);
        this.activeDirectories.delete(serviceDir);
      }
      return assignments.length;
    }

    if (assignments.length === 0) {
      logger.debug('No assignable requests');
      return 0;
    }

    // Dispatch all via A2A (fire-and-forget)
    for (const request of assignments) {
      this.processViaA2A(request);
    }

    logger.debug(`Dispatch complete: ${assignments.length} request(s) sent via A2A`);
    return assignments.length;
  }

  get status(): DispatcherStatus {
    return {
      running: true,
      workers: [], // No local workers in A2A-only mode
      pendingQueue: this.pendingQueue,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
    };
  }

  /** Expose adapter for direct session invocation (console → orchestrator). */
  getAdapter(): AgentAdapter {
    return this.adapter;
  }

  /** Expose session manager for orchestrator console. */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  // ── Constraint filtering ────────────────────────────────────────────────

  private filterAssignable(pending: AccordRequest[]): AccordRequest[] {
    const assignable: AccordRequest[] = [];
    const accordDir = getAccordDir(this.targetDir, this.accordConfig);

    for (const request of pending) {
      const serviceName = request.serviceName;

      // Constraint 0: dependency check
      const depStatus = getDependencyStatus(request, accordDir);
      if (!depStatus.ready) {
        logger.info(`Deferred ${request.frontmatter.id}: waiting for ${depStatus.pending.join(', ')}`);
        continue;
      }

      // Constraint 0b: maintainer type check
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
          logger.debug(`Skipping ${request.frontmatter.id}: service ${serviceName} is external`);
          continue;
        }
      }

      // Constraint 1: no concurrent dispatch to same service
      if (this.activeServices.has(serviceName)) {
        logger.debug(`Skipping ${request.frontmatter.id}: service ${serviceName} already active`);
        continue;
      }

      // Constraint 2: no concurrent dispatch to same directory
      const serviceDir = path.resolve(getServiceDir(this.accordConfig, serviceName, this.targetDir));
      if (this.activeDirectories.has(serviceDir)) {
        logger.debug(`Skipping ${request.frontmatter.id}: directory ${serviceDir} already in use`);
        continue;
      }

      // Constraint 3: must have a2a_url configured
      if (!this.getA2AUrl(request)) {
        logger.debug(`Skipping ${request.frontmatter.id}: no a2a_url configured for ${serviceName}`);
        continue;
      }

      assignable.push(request);
      this.activeServices.add(serviceName);
      this.activeDirectories.add(serviceDir);
    }

    return assignable;
  }

  // ── A2A dispatch ──────────────────────────────────────────────────────────

  private getA2AUrl(request: AccordRequest): string | undefined {
    const serviceName = request.serviceName;

    const svcConfig = getServiceConfig(this.accordConfig, serviceName);
    if (svcConfig?.a2a_url) return svcConfig.a2a_url;

    const accordDir = getAccordDir(this.targetDir, this.accordConfig);
    const registry = loadRegistryYaml(accordDir, serviceName);
    if (registry?.a2a_url) return registry.a2a_url;

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
        if ('kind' in event && event.kind === 'task') {
          const task = event as import('@a2a-js/sdk').Task;
          taskId = task.id;
          contextId = task.contextId;
        }

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
            requestId, service: serviceName, taskId, contextId, state, message,
          });

          if (state === 'working') {
            eventBus.emit('request:claimed', {
              requestId, service: serviceName, workerId: -1,
            });
          } else if (state === 'completed') {
            try {
              const finalTask = await this.a2aClient.getTask(a2aUrl, taskId);
              const contractUpdates = this.a2aClient.extractContractUpdates(finalTask);
              for (const update of contractUpdates) {
                eventBus.emit('a2a:artifact-update', {
                  requestId, service: serviceName, taskId,
                  artifactName: 'contract-update', artifactData: update,
                });
              }
            } catch (err) {
              logger.warn(`A2A: Failed to extract contract updates for ${requestId}: ${err}`);
            }

            this.totalProcessed += 1;
            eventBus.emit('request:completed', {
              requestId, service: serviceName, workerId: -1,
              result: { requestId, success: true, durationMs: 0, completedAt: new Date().toISOString() },
            });
          } else if (state === 'failed' || state === 'canceled') {
            this.totalProcessed += 1;
            this.totalFailed += 1;
            eventBus.emit('request:failed', {
              requestId, service: serviceName, workerId: -1,
              error: message || `A2A task ${state}`, willRetry: false,
            });
          }
        }

        if ('kind' in event && event.kind === 'artifact-update') {
          const artifactEvent = event as import('@a2a-js/sdk').TaskArtifactUpdateEvent;
          eventBus.emit('a2a:artifact-update', {
            requestId, service: serviceName, taskId: artifactEvent.taskId,
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
        requestId, service: serviceName, workerId: -1,
        error: `A2A dispatch error: ${err}`, willRetry: false,
      });
    } finally {
      this.activeServices.delete(serviceName);
      this.activeDirectories.delete(serviceDir);
    }
  }
}
