// Accord Agent — shared types and interfaces

// ── Request types ──────────────────────────────────────────────────────────

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'in-progress' | 'completed' | 'failed';
export type RequestScope = 'external' | 'internal';
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
}

export interface AccordRequest {
  frontmatter: RequestFrontmatter;
  body: string;
  filePath: string;
  serviceName: string;
}

// ── Config types ───────────────────────────────────────────────────────────

export interface ModuleConfig {
  name: string;
  path?: string;
  type?: string;
}

export interface ServiceConfig {
  name: string;
  modules?: ModuleConfig[];
  directory?: string;
  repo?: string;
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
}

export interface AccordSettings {
  sync_mode?: string;
  auto_pull_on_start?: boolean;
  require_human_approval?: boolean;
  archive_completed?: boolean;
  debug?: boolean;
  agent_cmd?: string;
}

export interface AccordConfig {
  version: string;
  project: { name: string };
  repo_model: 'monorepo' | 'multi-repo';
  hub?: string;
  role?: 'orchestrator' | 'service';
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

// ── Worker types ───────────────────────────────────────────────────────────

export type WorkerState = 'idle' | 'busy';

export interface WorkerStatus {
  workerId: number;
  state: WorkerState;
  currentRequest: string | null;
  sessions: Map<string, SessionInfo>;
}

// ── Result types ───────────────────────────────────────────────────────────

export interface RequestResult {
  requestId: string;
  success: boolean;
  durationMs: number;
  costUsd?: number;
  numTurns?: number;
  error?: string;
  sessionId?: string;
}

// ── Dispatcher types ───────────────────────────────────────────────────────

export interface DispatcherStatus {
  running: boolean;
  workers: WorkerStatus[];
  pendingQueue: number;
  totalProcessed: number;
  totalFailed: number;
}

// ── Logger types ───────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
