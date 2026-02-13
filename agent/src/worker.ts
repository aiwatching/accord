import type { AccordConfig, AccordRequest, DispatcherConfig, RequestResult, WorkerState } from './types.js';
import type { AgentAdapter } from './agent-adapter.js';
import { SessionManager } from './session.js';
import { logger } from './logger.js';
import { executeCommand, isValidCommand } from './commands.js';
import { buildAgentPrompt } from './prompt.js';
import {
  setRequestStatus,
  incrementAttempts,
  archiveRequest,
  appendResultSection,
  createEscalation,
} from './request.js';
import { gitCommit } from './sync.js';
import { writeHistory } from './history.js';
import { getServiceDir, getAccordDir } from './config.js';

export class Worker {
  readonly id: number;
  private state: WorkerState = 'idle';
  private currentRequestId: string | null = null;
  private config: DispatcherConfig;
  private accordConfig: AccordConfig;
  private sessionManager: SessionManager;
  private adapter: AgentAdapter;
  private targetDir: string;
  /** Last service this worker processed — used for session affinity */
  lastServiceName: string | null = null;

  constructor(
    id: number,
    config: DispatcherConfig,
    accordConfig: AccordConfig,
    sessionManager: SessionManager,
    adapter: AgentAdapter,
    targetDir: string,
  ) {
    this.id = id;
    this.config = config;
    this.accordConfig = accordConfig;
    this.sessionManager = sessionManager;
    this.adapter = adapter;
    this.targetDir = targetDir;
  }

  get status(): { state: WorkerState; currentRequest: string | null } {
    return { state: this.state, currentRequest: this.currentRequestId };
  }

  isIdle(): boolean {
    return this.state === 'idle';
  }

  async processRequest(request: AccordRequest): Promise<RequestResult> {
    const startTime = Date.now();
    this.state = 'busy';
    this.currentRequestId = request.frontmatter.id;
    const reqId = request.frontmatter.id;
    const serviceName = request.serviceName;

    logger.info(`Worker ${this.id}: processing ${reqId} for ${serviceName}`);

    const serviceDir = getServiceDir(this.accordConfig, serviceName, this.targetDir);
    const accordDir = getAccordDir(serviceDir, this.accordConfig);
    const historyDir = `${accordDir}/comms/history`;

    try {
      // Command fast-path: no AI agent needed
      if (request.frontmatter.type === 'command' && request.frontmatter.command) {
        return await this.processCommand(request, serviceDir, accordDir, historyDir, startTime);
      }

      // Full AI agent invocation
      return await this.processWithAgent(request, serviceDir, accordDir, historyDir, startTime);
    } catch (err) {
      const error = String(err);
      logger.error(`Worker ${this.id}: unexpected error processing ${reqId}: ${error}`);
      return {
        requestId: reqId,
        success: false,
        durationMs: Date.now() - startTime,
        error,
      };
    } finally {
      this.lastServiceName = serviceName;
      this.state = 'idle';
      this.currentRequestId = null;
    }
  }

  private async processCommand(
    request: AccordRequest,
    serviceDir: string,
    accordDir: string,
    historyDir: string,
    startTime: number,
  ): Promise<RequestResult> {
    const reqId = request.frontmatter.id;
    const command = request.frontmatter.command!;

    logger.info(`Worker ${this.id}: command fast-path "${command}" for ${reqId}`);

    if (!isValidCommand(command)) {
      const error = `Invalid command: ${command}`;
      appendResultSection(request.filePath, error);
      setRequestStatus(request.filePath, 'completed');
      archiveRequest(request.filePath, accordDir);
      return { requestId: reqId, success: false, durationMs: Date.now() - startTime, error };
    }

    const result = executeCommand(command, serviceDir, accordDir);

    // Update request: append result, set completed, archive
    appendResultSection(request.filePath, result);
    setRequestStatus(request.filePath, 'completed');

    writeHistory({
      historyDir,
      requestId: reqId,
      fromStatus: 'pending',
      toStatus: 'completed',
      actor: request.serviceName,
      detail: `command: ${command}`,
    });

    archiveRequest(request.filePath, accordDir);

    gitCommit(serviceDir, `accord: command "${command}" completed for ${reqId}`);

    return {
      requestId: reqId,
      success: true,
      durationMs: Date.now() - startTime,
    };
  }

  private async processWithAgent(
    request: AccordRequest,
    serviceDir: string,
    accordDir: string,
    historyDir: string,
    startTime: number,
  ): Promise<RequestResult> {
    const reqId = request.frontmatter.id;
    const serviceName = request.serviceName;

    // Step 1: Check session rotation
    if (this.sessionManager.shouldRotate(serviceName)) {
      this.sessionManager.rotateSession(serviceName);
    }

    // Step 2: Claim — set in-progress, commit + push
    setRequestStatus(request.filePath, 'in-progress');
    const attempts = incrementAttempts(request.filePath);
    gitCommit(serviceDir, `accord: claim ${reqId} (attempt ${attempts})`);

    writeHistory({
      historyDir,
      requestId: reqId,
      fromStatus: 'pending',
      toStatus: 'in-progress',
      actor: serviceName,
      directiveId: request.frontmatter.directive,
    });

    // Step 3: Build prompt
    const checkpoint = this.sessionManager.readCheckpoint(accordDir, reqId);
    const prompt = buildAgentPrompt({
      request,
      serviceName,
      targetDir: serviceDir,
      accordDir,
      checkpoint: checkpoint ?? undefined,
    });

    // Step 4: Invoke agent via adapter
    const existingSession = this.adapter.supportsResume
      ? this.sessionManager.getSession(serviceName)
      : undefined;
    const resumeId = existingSession?.sessionId;

    try {
      const result = await this.adapter.invoke({
        prompt,
        cwd: serviceDir,
        resumeSessionId: resumeId,
        timeout: this.config.request_timeout,
        model: this.config.model,
        maxTurns: 50,
        maxBudgetUsd: this.config.max_budget_usd,
      });

      // Step 5: Success
      if (result.sessionId) {
        this.sessionManager.updateSession(serviceName, result.sessionId);
      }
      this.sessionManager.clearCheckpoint(accordDir, reqId);
      this.sessionManager.saveToDisk(accordDir);

      setRequestStatus(request.filePath, 'completed');
      archiveRequest(request.filePath, accordDir);

      writeHistory({
        historyDir,
        requestId: reqId,
        fromStatus: 'in-progress',
        toStatus: 'completed',
        actor: serviceName,
        directiveId: request.frontmatter.directive,
        detail: `cost=$${result.costUsd?.toFixed(4)}, turns=${result.numTurns}`,
      });

      gitCommit(serviceDir, `accord: completed ${reqId}`);

      return { ...result, requestId: reqId, success: true };
    } catch (err) {
      // Step 6: Failure handling
      const error = String(err);
      logger.error(`Worker ${this.id}: agent failed for ${reqId}: ${error}`);

      // Write checkpoint for crash recovery
      this.sessionManager.writeCheckpoint(accordDir, reqId, `Error: ${error}\nAttempt: ${attempts}`);

      if (attempts >= this.config.max_attempts) {
        // Max attempts reached: set failed, escalate
        setRequestStatus(request.filePath, 'failed');

        writeHistory({
          historyDir,
          requestId: reqId,
          fromStatus: 'in-progress',
          toStatus: 'failed',
          actor: serviceName,
          detail: `max attempts (${this.config.max_attempts}) reached: ${error}`,
        });

        createEscalation({
          accordDir,
          originalRequest: request,
          error,
          serviceName,
        });

        gitCommit(serviceDir, `accord: failed ${reqId} after ${attempts} attempts`);
      } else {
        // Revert to pending for retry
        setRequestStatus(request.filePath, 'pending');

        writeHistory({
          historyDir,
          requestId: reqId,
          fromStatus: 'in-progress',
          toStatus: 'pending',
          actor: serviceName,
          detail: `attempt ${attempts}/${this.config.max_attempts} failed: ${error}`,
        });

        gitCommit(serviceDir, `accord: revert ${reqId} to pending (attempt ${attempts}/${this.config.max_attempts})`);
      }

      return {
        requestId: reqId,
        success: false,
        durationMs: Date.now() - startTime,
        error,
      };
    }
  }

}
