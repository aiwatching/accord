// Accord Agent — shared types and interfaces

// ── Request types ──────────────────────────────────────────────────────────

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'in-progress' | 'completed' | 'failed';
export type RequestScope = 'external' | 'internal' | 'cross-team';
export type RequestPriority = 'low' | 'medium' | 'high' | 'critical';

export interface RequestFrontmatter {
  id: string;
  from: string;
  to: string;
  scope: RequestScope;
  type: string;
  priority: RequestPriority;
  status: RequestStatus;
  created: string;
  updated: string;
  related_contract?: string;
  // v2 fields
  directive?: string;
  on_behalf_of?: string;
  routed_by?: string;
  originated_from?: string;
  // command fields
  command?: string;
  command_args?: string;
  // retry tracking
  attempts?: number;
  // cascade fields (v2)
  parent_request?: string;
  child_requests?: string[];
  depends_on_requests?: string[];
}

export interface AccordRequest {
  frontmatter: RequestFrontmatter;
  body: string;
  filePath: string;
  serviceName: string;
}

// ── Directive types ──────────────────────────────────────────────────────────

export type DirectivePhase =
  | 'planning'       // orchestrator analyzing
  | 'negotiating'    // contract proposals sent, waiting for service confirmation
  | 'implementing'   // contracts settled, implementation requests dispatched
  | 'testing'        // implementation done, test-agent running
  | 'completed'
  | 'failed';

export interface DirectiveFrontmatter {
  id: string;
  title: string;
  priority: RequestPriority;
  status: DirectivePhase;
  created: string;
  updated: string;
  /** All request IDs produced by this directive */
  requests: string[];
  /** Contract-proposal request IDs */
  contract_proposals?: string[];
  /** Test request IDs */
  test_requests?: string[];
  retry_count?: number;
  max_retries?: number; // default 3
}

export interface DirectiveState {
  frontmatter: DirectiveFrontmatter;
  body: string;
  filePath: string;
}

// ── Config types ───────────────────────────────────────────────────────────

export interface ServiceConfig {
  name: string;
  type?: 'service' | 'module';
  directory?: string;
  language?: string;
  repo?: string;
  a2a_url?: string;
}

export interface DispatcherConfig {
  workers: number;
  poll_interval: number;
  session_max_requests: number;
  session_max_age_hours: number;
  request_timeout: number;
  max_attempts: number;
  model: string;
  max_budget_usd?: number;
  debug: boolean;
  /** HTTP server port (default: 3000) */
  port?: number;
  /** Agent adapter type: "claude-code" (default), "claude-code-v2" (persistent sessions), or "shell" */
  agent: 'claude-code' | 'claude-code-v2' | 'shell';
  /** Shell command for the "shell" adapter (e.g. "claude -p", "codex -q") */
  agent_cmd?: string;
  /** Enable planning stage before orchestrator execution (default: false) */
  planner_enabled?: boolean;
  /** Model for plan generation (default: 'claude-haiku-4-5-20251001') */
  planner_model?: string;
  /** Seconds to wait for user approval before auto-cancel (default: 300) */
  planner_timeout?: number;
  /** Enable coordination loop for directive lifecycle tracking (default: false) */
  coordination_loop_enabled?: boolean;
  /** Service name for integration test agent (e.g. 'integration-test') */
  test_agent_service?: string;
  /** Max retries for a directive before marking as failed (default: 3) */
  max_directive_retries?: number;
  /** Seconds to wait for contract negotiation before timeout (default: 600) */
  negotiation_timeout?: number;
}

export interface AccordSettings {
  sync_mode?: string;
  auto_pull_on_start?: boolean;
  require_human_approval?: boolean;
  archive_completed?: boolean;
  debug?: boolean;
  agent_cmd?: string;
}

/** Root-level accord.yaml (multi-team hub) */
export interface OrgConfig {
  version: string;
  org: string;
  teams: Array<{ name: string; description?: string }>;
}

export interface AccordConfig {
  version: string;
  project: { name: string };
  repo_model: 'monorepo' | 'multi-repo';
  hub?: string;
  role?: 'orchestrator' | 'service';
  /** For multi-team hubs: resolved team name */
  team?: string;
  /** For multi-team hubs: absolute path to the team directory (e.g. /path/hub/teams/my-team) */
  teamDir?: string;
  services: ServiceConfig[];
  settings?: AccordSettings;
  dispatcher?: Partial<DispatcherConfig>;
}

// ── Session types ──────────────────────────────────────────────────────────

export interface SessionInfo {
  sessionId: string;
  serviceName: string;
  createdAt: number;
  requestCount: number;
  lastUsedAt: number;
}

// ── Result types ───────────────────────────────────────────────────────────

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ModelUsageEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}

export interface RequestResult {
  requestId: string;
  success: boolean;
  durationMs: number;
  costUsd?: number;
  numTurns?: number;
  error?: string;
  sessionId?: string;
  /** ISO 8601 timestamp when this result was produced */
  completedAt?: string;
  /** Token-level usage breakdown */
  usage?: TokenUsage;
  /** Per-model usage breakdown */
  modelUsage?: Record<string, ModelUsageEntry>;
}

// ── Dispatcher types ───────────────────────────────────────────────────────

export interface DispatcherStatus {
  running: boolean;
  workers: unknown[]; // kept for API compat, always empty in A2A mode
  pendingQueue: number;
  totalProcessed: number;
  totalFailed: number;
}

// ── Logger types ───────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// ── Registry types ──────────────────────────────────────────────────────

export type MaintainerType = 'ai' | 'human' | 'hybrid' | 'external';

/** YAML registry entry at registry/{name}.yaml */
export interface RegistryYaml {
  name: string;
  type?: 'service' | 'module';
  description?: string;
  maintainer: MaintainerType;
  owner?: string;
  language?: string;
  directory?: string;
  contract?: string;
  owns?: string[];
  exposes?: string[];
  depends_on?: (string | { service: string; contract: string } | { team: string; contract: string })[];
  responsibility?: string;
  a2a_url?: string;
}
