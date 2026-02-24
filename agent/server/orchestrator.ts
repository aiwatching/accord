// Accord — OrchestratorCoordinator
// Manages directive lifecycle: planning → negotiating → implementing → testing → completed
// Listens to request events and drives phase transitions.

import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import type {
  AccordConfig,
  DirectiveState,
  DirectiveFrontmatter,
  DirectivePhase,
  RequestStatus,
} from './types.js';
import { eventBus } from './event-bus.js';
import type { RequestCompletedEvent, RequestFailedEvent } from './event-bus.js';
import { scanDirectives, parseDirective, scanInboxes, scanArchives } from './scanner.js';
import { getAccordDir, getInboxPath } from './config.js';
import { buildContractProposalBody, buildTestRequestBody } from './prompt.js';
import { logger } from './logger.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface RequestGroupStatus {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  inProgress: number;
}

interface CoordinatorParams {
  config: AccordConfig;
  hubDir: string;
  testAgentService?: string;
  maxRetries?: number;
  negotiationTimeoutMs?: number;
}

// ── OrchestratorCoordinator ─────────────────────────────────────────────────

export class OrchestratorCoordinator {
  private activeDirectives = new Map<string, DirectiveState>();
  private negotiationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners: Array<() => void> = [];

  private config: AccordConfig;
  private hubDir: string;
  private accordDir: string;
  private testAgentService?: string;
  private maxRetries: number;
  private negotiationTimeoutMs: number;

  constructor(params: CoordinatorParams) {
    this.config = params.config;
    this.hubDir = params.hubDir;
    this.accordDir = getAccordDir(params.hubDir, params.config);
    this.testAgentService = params.testAgentService;
    this.maxRetries = params.maxRetries ?? 3;
    this.negotiationTimeoutMs = params.negotiationTimeoutMs ?? 600_000;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  start(): void {
    logger.info('OrchestratorCoordinator: starting');

    const onCompleted = (event: RequestCompletedEvent) => this.onRequestCompleted(event);
    const onFailed = (event: RequestFailedEvent) => this.onRequestFailed(event);

    eventBus.on('request:completed', onCompleted);
    eventBus.on('request:failed', onFailed);

    this.listeners.push(
      () => eventBus.removeListener('request:completed', onCompleted),
      () => eventBus.removeListener('request:failed', onFailed),
    );
  }

  stop(): void {
    logger.info('OrchestratorCoordinator: stopping');
    for (const cleanup of this.listeners) cleanup();
    this.listeners = [];
    for (const timer of this.negotiationTimers.values()) clearTimeout(timer);
    this.negotiationTimers.clear();
  }

  loadDirectives(): void {
    const directives = scanDirectives(this.accordDir);
    for (const d of directives) {
      // Only track active (non-terminal) directives
      if (d.frontmatter.status !== 'completed' && d.frontmatter.status !== 'failed') {
        this.activeDirectives.set(d.frontmatter.id, d);
      }
    }
    logger.info(`OrchestratorCoordinator: loaded ${this.activeDirectives.size} active directive(s)`);
  }

  /** Expose active directives for API/testing. */
  getActiveDirectives(): Map<string, DirectiveState> {
    return this.activeDirectives;
  }

  // ── Event handlers ──────────────────────────────────────────────────────

  private onRequestCompleted(event: RequestCompletedEvent): void {
    const state = this.findDirectiveForRequest(event.requestId);
    if (!state) return; // Not a directive-managed request
    logger.info(`Coordinator: request ${event.requestId} completed (directive: ${state.frontmatter.id})`);
    this.evaluateDirective(state);
  }

  private onRequestFailed(event: RequestFailedEvent): void {
    const state = this.findDirectiveForRequest(event.requestId);
    if (!state) return;
    logger.info(`Coordinator: request ${event.requestId} failed (directive: ${state.frontmatter.id})`);
    this.evaluateDirective(state);
  }

  // ── Phase evaluation ────────────────────────────────────────────────────

  private evaluateDirective(state: DirectiveState): void {
    const phase = state.frontmatter.status;
    switch (phase) {
      case 'negotiating':
        this.evaluateNegotiatingPhase(state);
        break;
      case 'implementing':
        this.evaluateImplementingPhase(state);
        break;
      case 'testing':
        this.evaluateTestingPhase(state);
        break;
      default:
        // planning, completed, failed — no automatic transitions from events
        break;
    }
  }

  private evaluateNegotiatingPhase(state: DirectiveState): void {
    const proposalIds = state.frontmatter.contract_proposals ?? [];
    if (proposalIds.length === 0) {
      // No proposals — go straight to implementing
      this.transitionDirective(state, 'implementing', 'No contract proposals needed');
      return;
    }

    const groupStatus = this.getRequestGroupStatus(proposalIds);

    // Any failed/rejected proposals?
    if (groupStatus.failed > 0) {
      const retryCount = (state.frontmatter.retry_count ?? 0) + 1;
      state.frontmatter.retry_count = retryCount;

      if (retryCount >= this.maxRetries) {
        this.transitionDirective(state, 'failed', `Contract negotiation failed after ${retryCount} retries`);
      } else {
        // Back to planning for re-negotiation (user/orchestrator session must re-plan)
        this.transitionDirective(state, 'planning', `Contract rejected (retry ${retryCount}/${this.maxRetries})`);
      }
      return;
    }

    // All completed?
    if (groupStatus.completed === groupStatus.total) {
      this.transitionDirective(state, 'implementing', 'All contracts accepted');
      return;
    }

    // Still pending — wait
  }

  private evaluateImplementingPhase(state: DirectiveState): void {
    // Implementation requests = all requests minus contract_proposals minus test_requests
    const implIds = this.getImplementationRequestIds(state);
    if (implIds.length === 0) return; // No impl requests yet — orchestrator session hasn't created them

    const groupStatus = this.getRequestGroupStatus(implIds);

    if (groupStatus.failed > 0) {
      // Some implementations failed — but don't immediately fail the directive
      // Wait until all are done (some may still be in progress)
      if (groupStatus.pending > 0 || groupStatus.inProgress > 0) return;
      // All done, but some failed
      this.transitionDirective(state, 'failed', `${groupStatus.failed}/${groupStatus.total} implementation(s) failed`);
      return;
    }

    if (groupStatus.completed === groupStatus.total) {
      // All implementations completed
      if (this.testAgentService) {
        const testRequestId = this.createTestRequest(state);
        if (!state.frontmatter.test_requests) state.frontmatter.test_requests = [];
        state.frontmatter.test_requests.push(testRequestId);
        state.frontmatter.requests.push(testRequestId);
        this.transitionDirective(state, 'testing', 'All implementations completed, test dispatched');
      } else {
        this.transitionDirective(state, 'completed', 'All implementations completed (no test agent configured)');
      }
      return;
    }

    // Still pending/in-progress — wait
  }

  private evaluateTestingPhase(state: DirectiveState): void {
    const testIds = state.frontmatter.test_requests ?? [];
    if (testIds.length === 0) return;

    // Check only the latest test request
    const latestTestId = testIds[testIds.length - 1];
    const groupStatus = this.getRequestGroupStatus([latestTestId]);

    if (groupStatus.completed === 1) {
      this.transitionDirective(state, 'completed', 'Integration tests passed');
      eventBus.emit('directive:test-result', {
        directiveId: state.frontmatter.id,
        testRequestId: latestTestId,
        passed: true,
      });
      return;
    }

    if (groupStatus.failed === 1) {
      eventBus.emit('directive:test-result', {
        directiveId: state.frontmatter.id,
        testRequestId: latestTestId,
        passed: false,
        details: 'Test request failed',
      });

      // Create fix requests and loop back to implementing
      const fixIds = this.createFixRequests(state, 'Integration test failed');
      for (const id of fixIds) {
        state.frontmatter.requests.push(id);
      }
      this.transitionDirective(state, 'implementing', 'Test failed, fix requests created');
      return;
    }

    // Still pending — wait
  }

  // ── Request creation ────────────────────────────────────────────────────

  private createTestRequest(state: DirectiveState): string {
    const epoch = Date.now();
    const id = `req-test-${epoch}`;
    const implIds = this.getImplementationRequestIds(state);

    const body = buildTestRequestBody({
      directiveTitle: state.frontmatter.title,
      services: this.getAffectedServices(state),
      contracts: this.getAffectedContracts(state),
      implementationSummary: `Directive "${state.frontmatter.title}" — ${implIds.length} implementation request(s) completed.`,
    });

    return this.writeRequest({
      id,
      from: 'orchestrator',
      to: this.testAgentService!,
      type: 'integration-test',
      priority: state.frontmatter.priority,
      directiveId: state.frontmatter.id,
      dependsOn: implIds,
      body,
    });
  }

  private createFixRequests(state: DirectiveState, details: string): string[] {
    const services = this.getAffectedServices(state);
    const fixIds: string[] = [];

    for (const service of services) {
      const epoch = Date.now();
      const id = `req-fix-${service}-${epoch}`;
      const body = [
        `## Fix Request`,
        '',
        `**Directive**: ${state.frontmatter.title}`,
        `**Reason**: ${details}`,
        '',
        '### Instructions',
        '',
        '- Review the integration test failure details.',
        '- Fix any issues in your service implementation.',
        '- When done, mark this request as `completed`.',
        '',
      ].join('\n');

      this.writeRequest({
        id,
        from: 'orchestrator',
        to: service,
        type: 'fix',
        priority: 'high',
        directiveId: state.frontmatter.id,
        body,
      });
      fixIds.push(id);
    }

    return fixIds;
  }

  writeRequest(params: {
    id: string;
    from: string;
    to: string;
    type: string;
    priority: string;
    directiveId: string;
    dependsOn?: string[];
    body: string;
  }): string {
    const inboxDir = getInboxPath(this.accordDir, params.to);
    fs.mkdirSync(inboxDir, { recursive: true });

    const now = new Date().toISOString();
    const frontmatter: Record<string, unknown> = {
      id: params.id,
      from: params.from,
      to: params.to,
      scope: 'external',
      type: params.type,
      priority: params.priority,
      status: 'pending',
      directive: params.directiveId,
      created: now,
      updated: now,
    };
    if (params.dependsOn && params.dependsOn.length > 0) {
      frontmatter.depends_on_requests = params.dependsOn;
    }

    const content = matter.stringify(params.body, frontmatter);
    const filePath = path.join(inboxDir, `${params.id}.md`);
    fs.writeFileSync(filePath, content, 'utf-8');

    logger.info(`Coordinator: created request ${params.id} → ${params.to}`);
    return params.id;
  }

  // ── Directive persistence ───────────────────────────────────────────────

  transitionDirective(state: DirectiveState, toPhase: DirectivePhase, message?: string): void {
    const fromPhase = state.frontmatter.status;
    state.frontmatter.status = toPhase;
    state.frontmatter.updated = new Date().toISOString();

    this.saveDirective(state);

    eventBus.emit('directive:phase-change', {
      directiveId: state.frontmatter.id,
      fromPhase,
      toPhase,
      message,
    });

    logger.info(`Coordinator: directive ${state.frontmatter.id} ${fromPhase} → ${toPhase}${message ? ': ' + message : ''}`);

    // Remove from active tracking if terminal
    if (toPhase === 'completed' || toPhase === 'failed') {
      this.activeDirectives.delete(state.frontmatter.id);
      this.negotiationTimers.delete(state.frontmatter.id);
    }
  }

  saveDirective(state: DirectiveState): void {
    const content = matter.stringify(state.body, state.frontmatter as unknown as Record<string, unknown>);
    fs.writeFileSync(state.filePath, content, 'utf-8');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  findDirectiveForRequest(requestId: string): DirectiveState | undefined {
    for (const state of this.activeDirectives.values()) {
      const fm = state.frontmatter;
      if (fm.requests.includes(requestId)) return state;
      if (fm.contract_proposals?.includes(requestId)) return state;
      if (fm.test_requests?.includes(requestId)) return state;
    }
    return undefined;
  }

  getRequestGroupStatus(requestIds: string[]): RequestGroupStatus {
    const result: RequestGroupStatus = {
      total: requestIds.length,
      completed: 0,
      failed: 0,
      pending: 0,
      inProgress: 0,
    };

    // Collect all known requests (inbox + archive)
    const allStatuses = new Map<string, RequestStatus>();

    const inboxRequests = scanInboxes(this.accordDir, this.config, this.hubDir);
    for (const req of inboxRequests) {
      allStatuses.set(req.frontmatter.id, req.frontmatter.status);
    }

    const archivedRequests = scanArchives(this.accordDir, this.config, this.hubDir);
    for (const req of archivedRequests) {
      allStatuses.set(req.frontmatter.id, req.frontmatter.status);
    }

    for (const id of requestIds) {
      const status = allStatuses.get(id);
      switch (status) {
        case 'completed':
          result.completed++;
          break;
        case 'failed':
        case 'rejected':
          result.failed++;
          break;
        case 'in-progress':
        case 'approved':
          result.inProgress++;
          break;
        case 'pending':
        default:
          result.pending++;
          break;
      }
    }

    return result;
  }

  private getImplementationRequestIds(state: DirectiveState): string[] {
    const contractIds = new Set(state.frontmatter.contract_proposals ?? []);
    const testIds = new Set(state.frontmatter.test_requests ?? []);
    return state.frontmatter.requests.filter(id => !contractIds.has(id) && !testIds.has(id));
  }

  private getAffectedServices(state: DirectiveState): string[] {
    const services = new Set<string>();
    const allRequests = [
      ...scanInboxes(this.accordDir, this.config, this.hubDir),
      ...scanArchives(this.accordDir, this.config, this.hubDir),
    ];
    for (const req of allRequests) {
      if (state.frontmatter.requests.includes(req.frontmatter.id)) {
        services.add(req.serviceName);
      }
    }
    return [...services];
  }

  private getAffectedContracts(state: DirectiveState): string[] {
    const contracts: string[] = [];
    const allRequests = [
      ...scanInboxes(this.accordDir, this.config, this.hubDir),
      ...scanArchives(this.accordDir, this.config, this.hubDir),
    ];
    for (const req of allRequests) {
      if (state.frontmatter.requests.includes(req.frontmatter.id) && req.frontmatter.related_contract) {
        contracts.push(req.frontmatter.related_contract);
      }
    }
    return [...new Set(contracts)];
  }
}
