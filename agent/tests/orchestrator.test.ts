import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import matter from 'gray-matter';
import { OrchestratorCoordinator } from '../server/orchestrator.js';
import { eventBus } from '../server/event-bus.js';
import type { AccordConfig, DirectiveFrontmatter, DirectivePhase } from '../server/types.js';

let tmpDir: string;
let accordDir: string;

const TEST_CONFIG: AccordConfig = {
  version: '2',
  project: { name: 'test-project' },
  repo_model: 'monorepo',
  role: 'orchestrator',
  services: [
    { name: 'svc-a' },
    { name: 'svc-b' },
    { name: 'integration-test' },
  ],
};

function createDirectiveFile(
  dir: string,
  overrides: Partial<DirectiveFrontmatter> & { body?: string } = {},
): string {
  const directivesDir = path.join(dir, 'directives');
  fs.mkdirSync(directivesDir, { recursive: true });

  const defaults: DirectiveFrontmatter = {
    id: `directive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test Directive',
    priority: 'high',
    status: 'implementing',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    requests: [],
    contract_proposals: [],
    test_requests: [],
    retry_count: 0,
    max_retries: 3,
  };

  const fm = { ...defaults, ...overrides };
  const body = overrides.body ?? 'Test directive body';
  const content = matter.stringify(body, fm as unknown as Record<string, unknown>);

  const filePath = path.join(directivesDir, `${fm.id}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function createRequestFile(
  dir: string,
  service: string,
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
): string {
  const inboxDir = path.join(dir, 'comms', 'inbox', service);
  fs.mkdirSync(inboxDir, { recursive: true });

  const fm: Record<string, unknown> = {
    id,
    from: 'orchestrator',
    to: service,
    scope: 'external',
    type: extra.type ?? 'implementation',
    priority: 'high',
    status,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    ...extra,
  };

  const content = matter.stringify('Request body', fm);
  const filePath = path.join(inboxDir, `${id}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function createArchivedRequest(
  dir: string,
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
): string {
  const archiveDir = path.join(dir, 'comms', 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });

  const fm: Record<string, unknown> = {
    id,
    from: 'orchestrator',
    to: extra.to ?? 'svc-a',
    scope: 'external',
    type: extra.type ?? 'implementation',
    priority: 'high',
    status,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    ...extra,
  };

  const content = matter.stringify('Request body', fm);
  const filePath = path.join(archiveDir, `${id}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accord-orchestrator-test-'));
  accordDir = tmpDir; // orchestrator role uses root as accordDir
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  eventBus.removeAllListeners();
});

describe('OrchestratorCoordinator', () => {
  describe('loadDirectives', () => {
    it('loads active directives from disk', () => {
      createDirectiveFile(accordDir, { id: 'dir-1', status: 'implementing' });
      createDirectiveFile(accordDir, { id: 'dir-2', status: 'completed' });
      createDirectiveFile(accordDir, { id: 'dir-3', status: 'negotiating' });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });
      coordinator.loadDirectives();

      const active = coordinator.getActiveDirectives();
      expect(active.size).toBe(2);
      expect(active.has('dir-1')).toBe(true);
      expect(active.has('dir-3')).toBe(true);
      expect(active.has('dir-2')).toBe(false); // completed is terminal
    });

    it('handles missing directives directory', () => {
      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });
      coordinator.loadDirectives();
      expect(coordinator.getActiveDirectives().size).toBe(0);
    });
  });

  describe('findDirectiveForRequest', () => {
    it('finds directive by request ID in requests array', () => {
      createDirectiveFile(accordDir, { id: 'dir-1', requests: ['req-1', 'req-2'] });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });
      coordinator.loadDirectives();

      const found = coordinator.findDirectiveForRequest('req-1');
      expect(found).toBeDefined();
      expect(found!.frontmatter.id).toBe('dir-1');
    });

    it('finds directive by contract_proposals', () => {
      createDirectiveFile(accordDir, {
        id: 'dir-1',
        requests: ['req-1'],
        contract_proposals: ['req-cp-1'],
      });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });
      coordinator.loadDirectives();

      const found = coordinator.findDirectiveForRequest('req-cp-1');
      expect(found).toBeDefined();
      expect(found!.frontmatter.id).toBe('dir-1');
    });

    it('finds directive by test_requests', () => {
      createDirectiveFile(accordDir, {
        id: 'dir-1',
        requests: ['req-1'],
        test_requests: ['req-test-1'],
      });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });
      coordinator.loadDirectives();

      const found = coordinator.findDirectiveForRequest('req-test-1');
      expect(found).toBeDefined();
    });

    it('returns undefined for unknown request', () => {
      createDirectiveFile(accordDir, { id: 'dir-1', requests: ['req-1'] });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });
      coordinator.loadDirectives();

      expect(coordinator.findDirectiveForRequest('req-unknown')).toBeUndefined();
    });
  });

  describe('getRequestGroupStatus', () => {
    it('counts completed requests from archive', () => {
      createArchivedRequest(accordDir, 'req-1', 'completed');
      createArchivedRequest(accordDir, 'req-2', 'completed');

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });

      const status = coordinator.getRequestGroupStatus(['req-1', 'req-2']);
      expect(status.total).toBe(2);
      expect(status.completed).toBe(2);
      expect(status.failed).toBe(0);
      expect(status.pending).toBe(0);
    });

    it('counts failed requests', () => {
      createArchivedRequest(accordDir, 'req-1', 'completed');
      createArchivedRequest(accordDir, 'req-2', 'failed');

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });

      const status = coordinator.getRequestGroupStatus(['req-1', 'req-2']);
      expect(status.completed).toBe(1);
      expect(status.failed).toBe(1);
    });

    it('counts pending requests from inbox', () => {
      createRequestFile(accordDir, 'svc-a', 'req-1', 'pending');
      createRequestFile(accordDir, 'svc-b', 'req-2', 'in-progress');

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });

      const status = coordinator.getRequestGroupStatus(['req-1', 'req-2']);
      expect(status.pending).toBe(1);
      expect(status.inProgress).toBe(1);
    });

    it('treats unknown requests as pending', () => {
      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });

      const status = coordinator.getRequestGroupStatus(['req-nonexistent']);
      expect(status.pending).toBe(1);
    });
  });

  describe('phase transitions', () => {
    it('transitions directive and saves to disk', () => {
      const filePath = createDirectiveFile(accordDir, { id: 'dir-1', status: 'implementing' });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });
      coordinator.loadDirectives();

      const state = coordinator.getActiveDirectives().get('dir-1')!;
      coordinator.transitionDirective(state, 'testing', 'All impl done');

      // Verify in-memory
      expect(state.frontmatter.status).toBe('testing');

      // Verify on disk
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { data } = matter(raw);
      expect(data.status).toBe('testing');
    });

    it('emits directive:phase-change event', () => {
      createDirectiveFile(accordDir, { id: 'dir-1', status: 'implementing' });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });
      coordinator.loadDirectives();

      const events: any[] = [];
      eventBus.on('directive:phase-change', (e) => events.push(e));

      const state = coordinator.getActiveDirectives().get('dir-1')!;
      coordinator.transitionDirective(state, 'testing', 'test msg');

      expect(events).toHaveLength(1);
      expect(events[0].directiveId).toBe('dir-1');
      expect(events[0].fromPhase).toBe('implementing');
      expect(events[0].toPhase).toBe('testing');
      expect(events[0].message).toBe('test msg');
    });

    it('removes directive from active tracking on terminal state', () => {
      createDirectiveFile(accordDir, { id: 'dir-1', status: 'testing' });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });
      coordinator.loadDirectives();
      expect(coordinator.getActiveDirectives().has('dir-1')).toBe(true);

      const state = coordinator.getActiveDirectives().get('dir-1')!;
      coordinator.transitionDirective(state, 'completed', 'done');

      expect(coordinator.getActiveDirectives().has('dir-1')).toBe(false);
    });
  });

  describe('negotiating phase', () => {
    it('transitions to implementing when all proposals completed', () => {
      createDirectiveFile(accordDir, {
        id: 'dir-1',
        status: 'negotiating',
        requests: ['req-cp-1', 'req-cp-2'],
        contract_proposals: ['req-cp-1', 'req-cp-2'],
      });
      createArchivedRequest(accordDir, 'req-cp-1', 'completed', { type: 'contract-proposal', directive: 'dir-1' });
      createArchivedRequest(accordDir, 'req-cp-2', 'completed', { type: 'contract-proposal', directive: 'dir-1' });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });
      coordinator.loadDirectives();
      coordinator.start();

      // Simulate request completed event
      eventBus.emit('request:completed', {
        requestId: 'req-cp-2',
        service: 'svc-a',
        workerId: -1,
        result: { requestId: 'req-cp-2', success: true, durationMs: 100 },
      });

      const state = coordinator.getActiveDirectives().get('dir-1')!;
      expect(state.frontmatter.status).toBe('implementing');

      coordinator.stop();
    });

    it('transitions to planning on rejection with retry', () => {
      createDirectiveFile(accordDir, {
        id: 'dir-1',
        status: 'negotiating',
        requests: ['req-cp-1'],
        contract_proposals: ['req-cp-1'],
        retry_count: 0,
        max_retries: 3,
      });
      createArchivedRequest(accordDir, 'req-cp-1', 'rejected', { type: 'contract-proposal', directive: 'dir-1' });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
        maxRetries: 3,
      });
      coordinator.loadDirectives();
      coordinator.start();

      eventBus.emit('request:completed', {
        requestId: 'req-cp-1',
        service: 'svc-a',
        workerId: -1,
        result: { requestId: 'req-cp-1', success: true, durationMs: 100 },
      });

      const state = coordinator.getActiveDirectives().get('dir-1')!;
      expect(state.frontmatter.status).toBe('planning');
      expect(state.frontmatter.retry_count).toBe(1);

      coordinator.stop();
    });

    it('transitions to failed when max retries exceeded', () => {
      createDirectiveFile(accordDir, {
        id: 'dir-1',
        status: 'negotiating',
        requests: ['req-cp-1'],
        contract_proposals: ['req-cp-1'],
        retry_count: 2,
      });
      createArchivedRequest(accordDir, 'req-cp-1', 'failed', { type: 'contract-proposal', directive: 'dir-1' });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
        maxRetries: 3,
      });
      coordinator.loadDirectives();
      coordinator.start();

      eventBus.emit('request:failed', {
        requestId: 'req-cp-1',
        service: 'svc-a',
        workerId: -1,
        error: 'rejected',
        willRetry: false,
      });

      // Should be removed from active (terminal state)
      expect(coordinator.getActiveDirectives().has('dir-1')).toBe(false);

      coordinator.stop();
    });

    it('transitions to implementing when no proposals exist', () => {
      createDirectiveFile(accordDir, {
        id: 'dir-1',
        status: 'negotiating',
        requests: ['req-impl-1'],
        contract_proposals: [],
      });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });
      coordinator.loadDirectives();
      coordinator.start();

      // Trigger evaluation via any related request event
      eventBus.emit('request:completed', {
        requestId: 'req-impl-1',
        service: 'svc-a',
        workerId: -1,
        result: { requestId: 'req-impl-1', success: true, durationMs: 100 },
      });

      // Since there are no proposals, it should have already transitioned
      // But the phase check in evaluateDirective only handles 'negotiating' if the phase was negotiating
      // After transition to implementing, it will also evaluate implementing phase
      const state = coordinator.getActiveDirectives().get('dir-1');
      // It should transition to implementing then evaluate impl phase
      // With req-impl-1 not yet in archive as completed, it stays at implementing
      expect(state).toBeDefined();
      expect(state!.frontmatter.status).toBe('implementing');

      coordinator.stop();
    });
  });

  describe('implementing phase', () => {
    it('transitions to testing when all implementations completed (with test agent)', () => {
      createDirectiveFile(accordDir, {
        id: 'dir-1',
        status: 'implementing',
        requests: ['req-impl-1', 'req-impl-2'],
        contract_proposals: [],
        test_requests: [],
      });
      createArchivedRequest(accordDir, 'req-impl-1', 'completed', { directive: 'dir-1' });
      createArchivedRequest(accordDir, 'req-impl-2', 'completed', { directive: 'dir-1' });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
        testAgentService: 'integration-test',
      });
      coordinator.loadDirectives();
      coordinator.start();

      eventBus.emit('request:completed', {
        requestId: 'req-impl-2',
        service: 'svc-b',
        workerId: -1,
        result: { requestId: 'req-impl-2', success: true, durationMs: 100 },
      });

      const state = coordinator.getActiveDirectives().get('dir-1')!;
      expect(state.frontmatter.status).toBe('testing');
      expect(state.frontmatter.test_requests!.length).toBe(1);

      // Verify test request was created
      const testReqId = state.frontmatter.test_requests![0];
      const testReqPath = path.join(accordDir, 'comms', 'inbox', 'integration-test', `${testReqId}.md`);
      expect(fs.existsSync(testReqPath)).toBe(true);

      coordinator.stop();
    });

    it('transitions to completed when all implementations done (no test agent)', () => {
      createDirectiveFile(accordDir, {
        id: 'dir-1',
        status: 'implementing',
        requests: ['req-impl-1'],
      });
      createArchivedRequest(accordDir, 'req-impl-1', 'completed', { directive: 'dir-1' });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
        // No testAgentService
      });
      coordinator.loadDirectives();
      coordinator.start();

      eventBus.emit('request:completed', {
        requestId: 'req-impl-1',
        service: 'svc-a',
        workerId: -1,
        result: { requestId: 'req-impl-1', success: true, durationMs: 100 },
      });

      // Terminal state — removed from active
      expect(coordinator.getActiveDirectives().has('dir-1')).toBe(false);

      coordinator.stop();
    });

    it('waits for all implementations when some are still pending', () => {
      createDirectiveFile(accordDir, {
        id: 'dir-1',
        status: 'implementing',
        requests: ['req-impl-1', 'req-impl-2'],
      });
      createArchivedRequest(accordDir, 'req-impl-1', 'completed', { directive: 'dir-1' });
      createRequestFile(accordDir, 'svc-b', 'req-impl-2', 'pending', { directive: 'dir-1' });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });
      coordinator.loadDirectives();
      coordinator.start();

      eventBus.emit('request:completed', {
        requestId: 'req-impl-1',
        service: 'svc-a',
        workerId: -1,
        result: { requestId: 'req-impl-1', success: true, durationMs: 100 },
      });

      const state = coordinator.getActiveDirectives().get('dir-1')!;
      expect(state.frontmatter.status).toBe('implementing'); // Still waiting

      coordinator.stop();
    });
  });

  describe('testing phase', () => {
    it('transitions to completed when test passes', () => {
      createDirectiveFile(accordDir, {
        id: 'dir-1',
        status: 'testing',
        requests: ['req-impl-1', 'req-test-1'],
        test_requests: ['req-test-1'],
      });
      createArchivedRequest(accordDir, 'req-test-1', 'completed', {
        type: 'integration-test',
        directive: 'dir-1',
        to: 'integration-test',
      });

      const testEvents: any[] = [];
      eventBus.on('directive:test-result', (e) => testEvents.push(e));

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
        testAgentService: 'integration-test',
      });
      coordinator.loadDirectives();
      coordinator.start();

      eventBus.emit('request:completed', {
        requestId: 'req-test-1',
        service: 'integration-test',
        workerId: -1,
        result: { requestId: 'req-test-1', success: true, durationMs: 100 },
      });

      expect(coordinator.getActiveDirectives().has('dir-1')).toBe(false);
      expect(testEvents).toHaveLength(1);
      expect(testEvents[0].passed).toBe(true);

      coordinator.stop();
    });

    it('creates fix requests and loops back to implementing on test failure', () => {
      createDirectiveFile(accordDir, {
        id: 'dir-1',
        status: 'testing',
        requests: ['req-impl-1', 'req-test-1'],
        test_requests: ['req-test-1'],
      });
      // Need an archived impl request so getAffectedServices works
      createArchivedRequest(accordDir, 'req-impl-1', 'completed', { directive: 'dir-1', to: 'svc-a' });
      createArchivedRequest(accordDir, 'req-test-1', 'failed', {
        type: 'integration-test',
        directive: 'dir-1',
        to: 'integration-test',
      });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
        testAgentService: 'integration-test',
      });
      coordinator.loadDirectives();
      coordinator.start();

      eventBus.emit('request:failed', {
        requestId: 'req-test-1',
        service: 'integration-test',
        workerId: -1,
        error: 'Tests failed',
        willRetry: false,
      });

      const state = coordinator.getActiveDirectives().get('dir-1')!;
      expect(state.frontmatter.status).toBe('implementing');
      // Fix requests should have been created and added to requests array
      expect(state.frontmatter.requests.length).toBeGreaterThan(2);

      coordinator.stop();
    });
  });

  describe('event-driven coordination', () => {
    it('ignores requests not belonging to any directive', () => {
      createDirectiveFile(accordDir, {
        id: 'dir-1',
        status: 'implementing',
        requests: ['req-1'],
      });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });
      coordinator.loadDirectives();
      coordinator.start();

      // This should not cause any errors or transitions
      eventBus.emit('request:completed', {
        requestId: 'req-unrelated',
        service: 'svc-a',
        workerId: -1,
        result: { requestId: 'req-unrelated', success: true, durationMs: 100 },
      });

      const state = coordinator.getActiveDirectives().get('dir-1')!;
      expect(state.frontmatter.status).toBe('implementing');

      coordinator.stop();
    });
  });

  describe('writeRequest', () => {
    it('creates request file in correct inbox', () => {
      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });

      const id = coordinator.writeRequest({
        id: 'req-test-123',
        from: 'orchestrator',
        to: 'svc-a',
        type: 'integration-test',
        priority: 'high',
        directiveId: 'dir-1',
        body: 'Test body content',
      });

      expect(id).toBe('req-test-123');

      const filePath = path.join(accordDir, 'comms', 'inbox', 'svc-a', 'req-test-123.md');
      expect(fs.existsSync(filePath)).toBe(true);

      const raw = fs.readFileSync(filePath, 'utf-8');
      const { data, content } = matter(raw);
      expect(data.id).toBe('req-test-123');
      expect(data.from).toBe('orchestrator');
      expect(data.to).toBe('svc-a');
      expect(data.type).toBe('integration-test');
      expect(data.directive).toBe('dir-1');
      expect(data.status).toBe('pending');
      expect(content.trim()).toContain('Test body content');
    });

    it('includes depends_on_requests when provided', () => {
      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });

      coordinator.writeRequest({
        id: 'req-test-456',
        from: 'orchestrator',
        to: 'svc-b',
        type: 'integration-test',
        priority: 'high',
        directiveId: 'dir-1',
        dependsOn: ['req-impl-1', 'req-impl-2'],
        body: 'Test',
      });

      const filePath = path.join(accordDir, 'comms', 'inbox', 'svc-b', 'req-test-456.md');
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { data } = matter(raw);
      expect(data.depends_on_requests).toEqual(['req-impl-1', 'req-impl-2']);
    });
  });

  describe('directive persistence', () => {
    it('saves updated frontmatter to disk', () => {
      const filePath = createDirectiveFile(accordDir, {
        id: 'dir-persist',
        status: 'implementing',
        requests: ['req-1'],
      });

      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });
      coordinator.loadDirectives();

      const state = coordinator.getActiveDirectives().get('dir-persist')!;
      state.frontmatter.requests.push('req-2');
      coordinator.saveDirective(state);

      const raw = fs.readFileSync(filePath, 'utf-8');
      const { data } = matter(raw);
      expect(data.requests).toEqual(['req-1', 'req-2']);
    });
  });

  describe('start/stop lifecycle', () => {
    it('subscribes and unsubscribes from events', () => {
      const coordinator = new OrchestratorCoordinator({
        config: TEST_CONFIG,
        hubDir: tmpDir,
      });

      const initialListeners = eventBus.listenerCount('request:completed');
      coordinator.start();
      expect(eventBus.listenerCount('request:completed')).toBe(initialListeners + 1);
      expect(eventBus.listenerCount('request:failed')).toBeGreaterThan(0);

      coordinator.stop();
      expect(eventBus.listenerCount('request:completed')).toBe(initialListeners);
    });
  });
});
