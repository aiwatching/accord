import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AccordConfig, AccordRequest, DispatcherConfig, DispatcherStatus } from './types.js';
import { SessionManager } from './session-manager.js';
import { createAdapter, type AgentAdapter, type StreamEvent } from './adapters/adapter.js';
import { logger } from './logger.js';
import { getDependencyStatus, setRequestStatus } from './scanner.js';
import { getAccordDir, getServiceDir, getServiceConfig, loadRegistryYaml } from './config.js';
import { AccordA2AClient } from './a2a/client.js';
import { buildAgentPrompt } from './prompt.js';
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
  // Track which services have an active dispatch
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

    // Create agent adapter (used by orchestrator console + local service dispatch)
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

    logger.info(`Dispatcher initialized: agent=${this.adapter.name}`);
  }

  /**
   * Dispatch a batch of pending requests via A2A or local agent.
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
        const mode = a2aUrl ? `A2A: ${a2aUrl}` : 'local';
        logger.info(`  [dry-run] ${request.frontmatter.id} → ${request.serviceName} (${request.frontmatter.priority}) via ${mode}`);
      }
      if (skipped > 0) {
        logger.info(`  [dry-run] ${skipped} request(s) deferred (constraint)`);
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

    // Dispatch: A2A if url configured, otherwise local agent invocation
    for (const request of assignments) {
      const a2aUrl = this.getA2AUrl(request);
      if (a2aUrl) {
        this.processViaA2A(request);
      } else {
        this.processLocal(request);
      }
    }

    logger.debug(`Dispatch complete: ${assignments.length} request(s) dispatched`);
    return assignments.length;
  }

  get status(): DispatcherStatus {
    return {
      running: true,
      workers: [],
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

      // No a2a_url constraint — local dispatch is the fallback

      assignable.push(request);
      this.activeServices.add(serviceName);
      this.activeDirectories.add(serviceDir);
    }

    return assignable;
  }

  // ── Session log persistence ─────────────────────────────────────────────

  /** Create or get the log file path for a request, ensuring the sessions dir exists. */
  private getLogFile(requestId: string, serviceName: string): string {
    const accordDir = getAccordDir(this.targetDir, this.accordConfig);
    const sessionsDir = path.join(accordDir, 'comms', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    return path.join(sessionsDir, `${requestId}.log`);
  }

  /** Write the initial header line to a session log file. */
  private initLogFile(logFile: string, requestId: string, serviceName: string, mode: string): void {
    fs.writeFileSync(logFile, `--- ${mode} | ${serviceName} | ${new Date().toISOString()} ---\n[REQUEST] ${requestId}\n`);
  }

  /** Append a line to a session log file (best-effort). */
  private appendLog(logFile: string, text: string): void {
    try {
      fs.appendFileSync(logFile, text);
    } catch {
      // Non-fatal — log writing should never block dispatch
    }
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
   * Includes idle timeout to detect hung SSE connections.
   */
  private async processViaA2A(request: AccordRequest): Promise<void> {
    const serviceName = request.serviceName;
    const serviceDir = path.resolve(getServiceDir(this.accordConfig, serviceName, this.targetDir));
    const accordDir = getAccordDir(this.targetDir, this.accordConfig);
    const a2aUrl = this.getA2AUrl(request)!;
    const requestId = request.frontmatter.id;
    const startTime = Date.now();
    // Idle timeout: if no SSE event arrives within this window, consider connection dead
    const idleTimeoutMs = (this.config.request_timeout || 600) * 1000;

    logger.info(`A2A dispatch: ${requestId} → ${serviceName} via ${a2aUrl}`);

    // Initialize session log file
    const logFile = this.getLogFile(requestId, serviceName);
    this.initLogFile(logFile, requestId, serviceName, 'a2a');

    // Mark request as in-progress
    try {
      setRequestStatus(request.filePath, 'in-progress');
    } catch {
      // Non-fatal — file may have been moved
    }

    let completed = false;

    try {
      let taskId = '';
      let contextId = '';

      const stream = this.a2aClient.sendRequest(a2aUrl, request);
      let done = false;

      while (!done) {
        // Race each next() against an idle timeout
        let timer: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`A2A stream idle timeout: no events for ${idleTimeoutMs / 1000}s (${requestId})`)),
            idleTimeoutMs,
          );
        });

        let next: IteratorResult<import('./a2a/client.js').A2AStreamEvent>;
        try {
          next = await Promise.race([stream.next(), timeoutPromise]);
          clearTimeout(timer!);
        } catch (err) {
          clearTimeout(timer!);
          // Signal generator to clean up
          try { await stream.return(undefined as never); } catch { /* ignore */ }
          throw err;
        }

        if (next.done) {
          done = true;
          break;
        }

        const event = next.value;

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

          this.appendLog(logFile, `[${state.toUpperCase()}] ${message}\n`);

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

            completed = true;
            const durationMs = Date.now() - startTime;
            this.totalProcessed += 1;
            this.appendLog(logFile, `\n--- completed | ${durationMs}ms ---\n`);
            eventBus.emit('request:completed', {
              requestId, service: serviceName, workerId: -1,
              result: { requestId, success: true, durationMs, completedAt: new Date().toISOString() },
            });
          } else if (state === 'failed' || state === 'canceled') {
            this.totalProcessed += 1;
            this.totalFailed += 1;
            this.appendLog(logFile, `\n--- failed | ${message || `A2A task ${state}`} ---\n`);
            eventBus.emit('request:failed', {
              requestId, service: serviceName, workerId: -1,
              error: message || `A2A task ${state}`, willRetry: false,
            });

            // Mark request as failed
            try {
              setRequestStatus(request.filePath, 'failed');
            } catch { /* Non-fatal */ }
          }
        }

        if ('kind' in event && event.kind === 'artifact-update') {
          const artifactEvent = event as import('@a2a-js/sdk').TaskArtifactUpdateEvent;
          this.appendLog(logFile, `[ARTIFACT] ${artifactEvent.artifact.name ?? 'unnamed'}\n`);
          eventBus.emit('a2a:artifact-update', {
            requestId, service: serviceName, taskId: artifactEvent.taskId,
            artifactName: artifactEvent.artifact.name ?? 'unnamed',
            artifactData: artifactEvent.artifact,
          });
        }
      }

      // Archive completed request
      if (completed) {
        this.archiveIfNeeded(request, accordDir);
      }
    } catch (err) {
      logger.error(`A2A dispatch failed for ${requestId}: ${err}`);
      this.totalProcessed += 1;
      this.totalFailed += 1;
      this.appendLog(logFile, `\n--- failed | ${err} ---\n`);
      eventBus.emit('request:failed', {
        requestId, service: serviceName, workerId: -1,
        error: `A2A dispatch error: ${err}`, willRetry: false,
      });

      // Mark request as failed
      try {
        setRequestStatus(request.filePath, 'failed');
      } catch { /* Non-fatal */ }

      // Invalidate cached client on failure (may have stale connection)
      this.a2aClient.invalidate(a2aUrl);
    } finally {
      this.activeServices.delete(serviceName);
      this.activeDirectories.delete(serviceDir);
    }
  }

  // ── Local dispatch (no A2A server needed) ─────────────────────────────────

  /**
   * Process a request by directly invoking the agent adapter on the service directory.
   * Emits the same events as A2A dispatch so the UI displays them identically.
   */
  private async processLocal(request: AccordRequest): Promise<void> {
    const serviceName = request.serviceName;
    const serviceDir = path.resolve(getServiceDir(this.accordConfig, serviceName, this.targetDir));
    const accordDir = getAccordDir(serviceDir, this.accordConfig);
    const requestId = request.frontmatter.id;
    const startTime = Date.now();

    logger.info(`Local dispatch: ${requestId} → ${serviceName} (dir: ${serviceDir})`);

    // Initialize session log file
    const logFile = this.getLogFile(requestId, serviceName);
    this.initLogFile(logFile, requestId, serviceName, 'local');

    // Emit claimed
    eventBus.emit('request:claimed', {
      requestId, service: serviceName, workerId: -1,
    });
    eventBus.emit('a2a:status-update', {
      requestId, service: serviceName, taskId: '', contextId: '',
      state: 'working', message: `Processing ${requestId}...`,
    });

    // Update request status to in-progress
    try {
      setRequestStatus(request.filePath, 'in-progress');
    } catch {
      // Non-fatal — file may have been moved
    }

    // Build prompt
    const prompt = buildAgentPrompt({
      request,
      serviceName,
      targetDir: serviceDir,
      accordDir,
    });

    try {
      const result = await this.adapter.invoke({
        prompt,
        cwd: serviceDir,
        timeout: this.config.request_timeout,
        model: this.config.model,
        maxTurns: 50,
        maxBudgetUsd: this.config.max_budget_usd,
        onOutput: (event: StreamEvent) => {
          // Format event for log file
          let logText: string;
          switch (event.type) {
            case 'text': logText = event.text; break;
            case 'tool_use': logText = `\n[${event.tool}] ${event.input}\n`; break;
            case 'tool_result': logText = `${event.output}\n`; break;
            case 'thinking': logText = `[thinking] ${event.text.slice(0, 500)}...\n`; break;
            case 'status': logText = `[status] ${event.text}\n`; break;
            default: logText = JSON.stringify(event) + '\n';
          }
          this.appendLog(logFile, logText);

          // Stream agent output as session events for the service
          eventBus.emit('session:output', {
            service: serviceName,
            chunk: event.type === 'text' ? event.text : `[${event.type}] ${JSON.stringify(event)}`,
            event,
            streamIndex: 0,
          });
        },
      });

      const durationMs = Date.now() - startTime;
      logger.info(`Local dispatch completed: ${requestId} — ${result.numTurns} turns, $${result.costUsd?.toFixed(4)}, ${durationMs}ms`);

      this.totalProcessed += 1;
      this.appendLog(logFile, `\n--- completed | ${durationMs}ms ---\n`);

      eventBus.emit('a2a:status-update', {
        requestId, service: serviceName, taskId: '', contextId: '',
        state: 'completed',
        message: `Completed. ${result.numTurns ?? '?'} turns, $${result.costUsd?.toFixed(4) ?? '?'}`,
      });
      eventBus.emit('request:completed', {
        requestId, service: serviceName, workerId: -1,
        result: { requestId, success: true, durationMs, completedAt: new Date().toISOString() },
      });

      // Move to archive if the agent didn't already
      this.archiveIfNeeded(request, accordDir);
    } catch (err) {
      const error = String(err);
      logger.error(`Local dispatch failed for ${requestId}: ${error}`);

      this.totalProcessed += 1;
      this.totalFailed += 1;
      this.appendLog(logFile, `\n--- failed | ${error} ---\n`);

      eventBus.emit('a2a:status-update', {
        requestId, service: serviceName, taskId: '', contextId: '',
        state: 'failed', message: error,
      });
      eventBus.emit('request:failed', {
        requestId, service: serviceName, workerId: -1,
        error, willRetry: false,
      });

      // Mark as failed
      try {
        setRequestStatus(request.filePath, 'failed');
      } catch {
        // Non-fatal
      }
    } finally {
      this.activeServices.delete(serviceName);
      this.activeDirectories.delete(serviceDir);
    }
  }

  /** Move completed request to archive if it's still in the inbox. */
  private archiveIfNeeded(request: AccordRequest, accordDir: string): void {
    try {
      if (!fs.existsSync(request.filePath)) return; // Agent already moved it
      const archiveDir = path.join(accordDir, 'comms', 'archive');
      fs.mkdirSync(archiveDir, { recursive: true });
      const dest = path.join(archiveDir, path.basename(request.filePath));
      setRequestStatus(request.filePath, 'completed');
      fs.renameSync(request.filePath, dest);
      logger.debug(`Archived: ${request.frontmatter.id} → ${dest}`);
    } catch (err) {
      logger.warn(`Failed to archive ${request.frontmatter.id}: ${err}`);
    }
  }
}
