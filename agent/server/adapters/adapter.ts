// Agent Adapter — abstraction layer for AI agent invocations.
//
// Allows the dispatcher to work with different agent backends:
//   - claude-code: Claude Agent SDK (native, supports session resume + streaming)
//   - shell: any CLI agent via child_process (e.g. "claude -p", "codex", custom scripts)

import * as path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import * as readline from 'node:readline';
import { logger } from '../logger.js';

// Ensure the current node binary's directory is in PATH.
// The Claude Agent SDK spawns `node` as a child process; if the server
// was started from a context with a limited PATH (IDE, daemon, launchd),
// `node` may not be found.  Fix once at module load time.
const nodeDir = path.dirname(process.execPath);
if (!process.env.PATH?.includes(nodeDir)) {
  process.env.PATH = `${nodeDir}${path.delimiter}${process.env.PATH ?? ''}`;
}

// ── Stream event types ──────────────────────────────────────────────────────

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; tool: string; input: string }
  | { type: 'tool_result'; tool: string; output: string; isError?: boolean }
  | { type: 'thinking'; text: string }
  | { type: 'status'; text: string };

// ── Types ───────────────────────────────────────────────────────────────────

export type AgentAdapterType = 'claude-code' | 'claude-code-v2' | 'shell';

export interface AgentInvocationParams {
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
  timeout: number;        // seconds
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  /** Streaming callback — receives structured events as the agent produces output. */
  onOutput?: (event: StreamEvent) => void;
}

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

export interface AgentInvocationResult {
  sessionId?: string;
  costUsd?: number;
  numTurns?: number;
  durationMs: number;
  usage?: TokenUsage;
  modelUsage?: Record<string, ModelUsageEntry>;
  /** If the agent tried to ask the user a question (AskUserQuestion), captured here. */
  pendingQuestion?: unknown;
}

export interface AgentAdapter {
  /** Adapter identifier (e.g. "claude-code", "shell") */
  readonly name: string;

  /** Whether this adapter supports session resume across requests */
  readonly supportsResume: boolean;

  /** Invoke the agent with the given prompt and parameters */
  invoke(params: AgentInvocationParams): Promise<AgentInvocationResult>;

  /** Close all managed sessions (for graceful shutdown). Only applicable to V2 adapter. */
  closeAll?(): Promise<void>;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export interface AdapterConfig {
  agent: AgentAdapterType;
  agent_cmd?: string;   // for shell adapter
  model?: string;       // default model
}

export function createAdapter(config: AdapterConfig): AgentAdapter {
  switch (config.agent) {
    case 'claude-code':
      return new ClaudeCodeCLIAdapter(config.model);

    case 'claude-code-v2':
      return new ClaudeCodeV2Adapter(config.model);

    case 'shell':
      return new ShellAdapter(
        config.agent_cmd ?? 'claude --dangerously-skip-permissions -p',
      );

    default:
      throw new Error(`Unknown agent adapter: ${config.agent}. Supported: claude-code, claude-code-v2, shell`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format tool input into a human-readable summary. */
function formatToolInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
      return String(input.file_path ?? '');
    case 'Write':
      return String(input.file_path ?? '');
    case 'Edit': {
      const fp = String(input.file_path ?? '');
      const old = String(input.old_string ?? '').slice(0, 60);
      return `${fp} — "${old}${(input.old_string as string)?.length > 60 ? '...' : ''}"`;
    }
    case 'Bash':
      return String(input.command ?? '').slice(0, 300);
    case 'Glob':
      return `${input.pattern ?? ''}${input.path ? ` in ${input.path}` : ''}`;
    case 'Grep':
      return `/${input.pattern ?? ''}/` + (input.path ? ` in ${input.path}` : '');
    case 'NotebookEdit':
      return String(input.notebook_path ?? '');
    case 'WebFetch':
      return String(input.url ?? '');
    case 'WebSearch':
      return String(input.query ?? '');
    default:
      return JSON.stringify(input).slice(0, 200);
  }
}

/** Extract text from tool result content (string or content block array). */
function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: Record<string, unknown>) => b.type === 'text')
      .map((b: Record<string, unknown>) => b.text)
      .join('\n');
  }
  return String(content ?? '');
}

/** Emit structured stream events from an assistant message's content blocks. */
function emitAssistantEvents(
  message: unknown,
  toolNames: Map<string, string>,
  onOutput?: (event: StreamEvent) => void,
): void {
  if (!onOutput) return;

  const msg = message as { content?: Array<Record<string, unknown>> };
  const blocks = msg?.content;
  if (!Array.isArray(blocks)) {
    if (typeof message === 'string' && message) {
      onOutput({ type: 'text', text: message });
    }
    return;
  }

  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      onOutput({ type: 'text', text: block.text as string });
    } else if (block.type === 'tool_use' && block.name) {
      toolNames.set(block.id as string, block.name as string);
      onOutput({
        type: 'tool_use',
        tool: block.name as string,
        input: formatToolInput(block.name as string, (block.input ?? {}) as Record<string, unknown>),
      });
    } else if (block.type === 'thinking' && block.thinking) {
      onOutput({ type: 'thinking', text: block.thinking as string });
    }
  }
}

/** Emit stream events from a user message (tool results). */
function emitToolResultEvents(
  message: unknown,
  toolNames: Map<string, string>,
  onOutput?: (event: StreamEvent) => void,
): void {
  if (!onOutput) return;

  const msg = message as { content?: Array<Record<string, unknown>> };
  const blocks = msg?.content;
  if (!Array.isArray(blocks)) return;

  for (const block of blocks) {
    if (block.type === 'tool_result') {
      const toolName = toolNames.get(block.tool_use_id as string) ?? 'unknown';
      const text = extractToolResultText(block.content);
      const maxLen = 2000;
      const truncated = text.length > maxLen ? text.slice(0, maxLen) + '\n... (truncated)' : text;
      onOutput({
        type: 'tool_result',
        tool: toolName,
        output: truncated,
        isError: block.is_error === true,
      });
    }
  }
}

/** Extract readable text (legacy, used by shell adapter fallback). */
function extractAssistantText(message: unknown): string {
  if (typeof message === 'string') return message;

  const msg = message as { content?: Array<{ type: string; text?: string; name?: string }> };
  const blocks = msg?.content;
  if (!Array.isArray(blocks)) return '';

  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    } else if (block.type === 'tool_use' && block.name) {
      parts.push(`[${block.name}]`);
    }
  }
  return parts.join('');
}

// ── Shared CLI spawn helper ─────────────────────────────────────────────────

export interface SpawnClaudeOptions {
  args: string[];
  cwd: string;
  timeout: number; // seconds
  /** Data to pipe to stdin. If provided, stdin is a pipe; otherwise stdin is ignored. */
  stdinData?: string;
  onLine?: (json: Record<string, unknown>) => void;
}

/**
 * Spawn the `claude` CLI with JSONL streaming output, parsing each line as JSON.
 * Cleans environment variables to prevent nesting detection.
 * Handles timeout via SIGTERM → 5s → SIGKILL.
 */
export function spawnClaude(options: SpawnClaudeOptions): Promise<void> {
  const { args, cwd, timeout, stdinData, onLine } = options;

  // Clean env to prevent Claude nesting detection
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SSE_PORT;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  return new Promise<void>((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd,
      env,
      // If stdinData is provided, pipe it; otherwise ignore stdin so
      // `claude -p` doesn't hang waiting for input.
      stdio: [stdinData != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    // Write prompt to stdin and close it immediately
    if (stdinData != null && child.stdin) {
      child.stdin.write(stdinData);
      child.stdin.end();
    }

    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    // Timeout: SIGTERM → 5s grace → SIGKILL
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
    }, timeout * 1000);

    // Parse JSONL from stdout
    const rl = readline.createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const json = JSON.parse(line) as Record<string, unknown>;
        onLine?.(json);
      } catch {
        // Ignore non-JSON lines (e.g. debug output)
      }
    });

    // Collect stderr
    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('close', (code) => {
      clearTimeout(timer);
      rl.close();

      if (killed) {
        settle(() => reject(new Error(`Agent timed out after ${timeout}s`)));
      } else if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString().trim();
        settle(() => reject(new Error(`claude CLI exited with code ${code}: ${stderr}`)));
      } else {
        settle(() => resolve());
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      settle(() => reject(new Error(`Failed to spawn claude CLI: ${err.message}`)));
    });
  });
}

// ── Claude Code CLI Adapter ─────────────────────────────────────────────────

class ClaudeCodeCLIAdapter implements AgentAdapter {
  readonly name = 'claude-code';
  readonly supportsResume = true;
  private defaultModel?: string;

  constructor(defaultModel?: string) {
    this.defaultModel = defaultModel;
  }

  async invoke(params: AgentInvocationParams): Promise<AgentInvocationResult> {
    const model = params.model ?? this.defaultModel ?? 'claude-sonnet-4-5-20250929';
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--dangerously-skip-permissions',
      '--verbose',
      '--setting-sources', 'project',
      '--model', model,
      '--allowed-tools', 'Read,Write,Edit,Bash,Glob,Grep,AskUserQuestion',
      '--disallowed-tools', 'EnterPlanMode,ExitPlanMode,Task,TaskCreate,TaskUpdate,TaskGet,TaskList,TaskOutput,TaskStop,Skill,NotebookEdit',
    ];

    if (params.resumeSessionId) {
      args.push('--resume', params.resumeSessionId);
    }
    if (params.maxBudgetUsd != null) {
      args.push('--max-budget-usd', String(params.maxBudgetUsd));
    }

    // Prompt is piped via stdin (not positional arg) to handle large prompts
    // and avoid ARG_MAX limits.

    const startTime = Date.now();
    let sessionId: string | undefined;
    let costUsd: number | undefined;
    let numTurns: number | undefined;
    let usage: TokenUsage | undefined;
    let modelUsage: Record<string, ModelUsageEntry> | undefined;
    let resultError: string | undefined;
    let pendingQuestion: unknown = undefined;

    const toolNames = new Map<string, string>();

    try {
      await spawnClaude({
        args,
        cwd: params.cwd,
        timeout: params.timeout,
        stdinData: params.prompt,
        onLine: (m) => {
          if (m.type === 'system' && m.subtype === 'init') {
            sessionId = m.session_id as string | undefined;
          } else if (m.type === 'assistant' && m.message) {
            // Capture AskUserQuestion tool calls before they fail
            const msg = m.message as { content?: Array<Record<string, unknown>> };
            if (Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
                  pendingQuestion = block.input;
                  logger.info('[claude-code] Captured AskUserQuestion tool call');
                }
              }
            }
            emitAssistantEvents(m.message, toolNames, params.onOutput);
          } else if (m.type === 'user' && m.message) {
            emitToolResultEvents(m.message, toolNames, params.onOutput);
          } else if (m.type === 'result') {
            sessionId = m.session_id as string | undefined;
            costUsd = m.total_cost_usd as number | undefined;
            numTurns = m.num_turns as number | undefined;

            if (m.usage) {
              const u = m.usage as Record<string, number>;
              usage = {
                input_tokens: u.input_tokens ?? 0,
                output_tokens: u.output_tokens ?? 0,
                cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
                cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
              };
            }
            if (m.modelUsage) {
              modelUsage = m.modelUsage as Record<string, ModelUsageEntry>;
            }

            if (m.is_error) {
              const errors = m.errors as string[] | undefined;
              resultError = `Agent error (${m.subtype}): ${errors?.join(', ') ?? 'unknown'}`;
            }

            logger.info(`[claude-code] Completed: ${numTurns} turns, $${costUsd?.toFixed(4)}, input=${usage?.input_tokens ?? '?'}, output=${usage?.output_tokens ?? '?'}, cache_read=${usage?.cache_read_input_tokens ?? '?'}`);
          }
        },
      });
    } catch (err) {
      // If the CLI failed but we captured a question, return it gracefully
      if (pendingQuestion) {
        logger.info('[claude-code] CLI errored on AskUserQuestion — returning question to caller');
        return {
          sessionId,
          costUsd,
          numTurns,
          durationMs: Date.now() - startTime,
          usage,
          modelUsage,
          pendingQuestion,
        };
      }
      throw err;
    }

    // If result-level error but we have a pending question, return gracefully
    if (resultError && pendingQuestion) {
      logger.info('[claude-code] Agent error on AskUserQuestion — returning question to caller');
      return {
        sessionId,
        costUsd,
        numTurns,
        durationMs: Date.now() - startTime,
        usage,
        modelUsage,
        pendingQuestion,
      };
    }

    if (resultError) throw new Error(resultError);

    return {
      sessionId,
      costUsd,
      numTurns,
      durationMs: Date.now() - startTime,
      usage,
      modelUsage,
    };
  }
}

// ── Claude Code V2 Adapter (Persistent Sessions) ───────────────────────────

interface ManagedSession {
  session: { sessionId: string; send(msg: string): Promise<void>; stream(): AsyncGenerator<unknown, void>; close(): void };
  cwd: string;
  sessionId: string;
  createdAt: number;
  requestCount: number;
  lastUsedAt: number;
  busy: boolean;
  activeStream: AsyncGenerator<unknown, void>;
}

/**
 * V2 adapter using the Claude Agent SDK's persistent session API
 * (`unstable_v2_createSession` / `unstable_v2_resumeSession`).
 *
 * Key differences from V1:
 * - Sessions persist across requests — no 2-5s startup overhead per request
 * - Uses `process.chdir()` workaround (SDK lacks `cwd` option)
 * - Requires `~/.claude/settings.json` permission allows (SDK can't bypass permissions)
 * - Project CLAUDE.md is NOT loaded by the SDK (context must be in prompt)
 *
 * Opt-in via `agent: 'claude-code-v2'` in config.
 */
class ClaudeCodeV2Adapter implements AgentAdapter {
  readonly name = 'claude-code-v2';
  readonly supportsResume = true;
  private defaultModel?: string;
  private sessions = new Map<string, ManagedSession>();
  private readonly maxRequests: number;
  private readonly maxAgeMs: number;

  constructor(defaultModel?: string, maxRequests = 50, maxAgeHours = 4) {
    this.defaultModel = defaultModel;
    this.maxRequests = maxRequests;
    this.maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  }

  async invoke(params: AgentInvocationParams): Promise<AgentInvocationResult> {
    const managed = await this.getOrCreateSession(params.cwd, params.model, params.resumeSessionId);
    managed.busy = true;
    const startTime = Date.now();

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Send prompt to the persistent session
      await managed.session.send(params.prompt);

      // Collect streamed messages with timeout via Promise.race
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Agent timed out after ${params.timeout}s`)),
          params.timeout * 1000,
        );
      });

      const result = await Promise.race([
        this.collectStream(managed, params.onOutput),
        timeoutPromise,
      ]);

      managed.requestCount++;
      managed.lastUsedAt = Date.now();

      if (this.shouldRotate(managed)) {
        await this.closeSession(params.cwd);
      }

      return { ...result, durationMs: Date.now() - startTime };
    } catch (err) {
      // On error (including timeout), close the session to avoid stale state
      await this.closeSession(params.cwd);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      const s = this.sessions.get(params.cwd);
      if (s) s.busy = false;
    }
  }

  async closeAll(): Promise<void> {
    const cwds = [...this.sessions.keys()];
    for (const cwd of cwds) {
      await this.closeSession(cwd);
    }
    if (cwds.length > 0) {
      logger.info(`[claude-code-v2] All ${cwds.length} session(s) closed`);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async getOrCreateSession(
    cwd: string,
    model?: string,
    resumeSessionId?: string,
  ): Promise<ManagedSession> {
    const existing = this.sessions.get(cwd);
    if (existing && !this.shouldRotate(existing)) {
      return existing;
    }
    if (existing) {
      await this.closeSession(cwd);
    }
    return this.createManagedSession(cwd, model, resumeSessionId);
  }

  private async createManagedSession(
    cwd: string,
    model?: string,
    resumeSessionId?: string,
  ): Promise<ManagedSession> {
    // Dynamic import — keeps the SDK optional (tests can run without it)
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const resolvedModel = model ?? this.defaultModel ?? 'claude-sonnet-4-5-20250929';
    const options = { model: resolvedModel, env: process.env };

    // process.chdir() workaround: the V2 SDK has no `cwd` option.
    // Safe because createSession/resumeSession are synchronous and
    // the Dispatcher prevents concurrent same-cwd access.
    const originalCwd = process.cwd();
    let session: ManagedSession['session'];
    try {
      process.chdir(cwd);
      if (resumeSessionId) {
        session = sdk.unstable_v2_resumeSession(resumeSessionId, options);
        logger.info(`[claude-code-v2] Resumed session ${resumeSessionId} for ${cwd}`);
      } else {
        session = sdk.unstable_v2_createSession(options);
        logger.info(`[claude-code-v2] Created new session for ${cwd}`);
      }
    } finally {
      process.chdir(originalCwd);
    }

    // Start the long-lived stream — persists across send() calls
    const activeStream = session.stream();

    const managed: ManagedSession = {
      session,
      cwd,
      sessionId: resumeSessionId ?? '',
      createdAt: Date.now(),
      requestCount: 0,
      lastUsedAt: Date.now(),
      busy: false,
      activeStream,
    };

    this.sessions.set(cwd, managed);
    return managed;
  }

  /**
   * Iterate the session's stream until a `result` message arrives.
   * Uses `.next()` instead of `for await` to avoid closing the generator on break.
   */
  private async collectStream(
    managed: ManagedSession,
    onOutput?: (event: StreamEvent) => void,
  ): Promise<Omit<AgentInvocationResult, 'durationMs'>> {
    let sessionId: string | undefined;
    let costUsd: number | undefined;
    let numTurns: number | undefined;
    let usage: TokenUsage | undefined;
    let modelUsage: Record<string, ModelUsageEntry> | undefined;

    // Track tool_use_id → tool name for labeling tool results
    const toolNames = new Map<string, string>();

    while (true) {
      const { value: msg, done } = await managed.activeStream.next();
      if (done || !msg) break;

      const m = msg as Record<string, unknown>;

      if (m.type === 'system' && m.subtype === 'init') {
        sessionId = m.session_id as string | undefined;
        if (sessionId) managed.sessionId = sessionId;
      } else if (m.type === 'assistant' && m.message) {
        emitAssistantEvents(m.message, toolNames, onOutput);
      } else if (m.type === 'user' && m.message) {
        emitToolResultEvents(m.message, toolNames, onOutput);
      } else if (m.type === 'result') {
        sessionId = m.session_id as string | undefined;
        costUsd = m.total_cost_usd as number | undefined;
        numTurns = m.num_turns as number | undefined;

        // Capture token-level usage data
        if (m.usage) {
          const u = m.usage as Record<string, number>;
          usage = {
            input_tokens: u.input_tokens ?? 0,
            output_tokens: u.output_tokens ?? 0,
            cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
          };
        }
        if (m.modelUsage) {
          modelUsage = m.modelUsage as Record<string, ModelUsageEntry>;
        }

        if (m.is_error) {
          const errors = m.errors as string[] | undefined;
          throw new Error(`Agent error (${m.subtype}): ${errors?.join(', ') ?? 'unknown'}`);
        }

        logger.info(`[claude-code-v2] Completed: ${numTurns} turns, $${costUsd?.toFixed(4)}, input=${usage?.input_tokens ?? '?'}, output=${usage?.output_tokens ?? '?'}, cache_read=${usage?.cache_read_input_tokens ?? '?'}`);
        break; // This interaction is complete — stream stays alive for next send()
      }
    }

    return { sessionId, costUsd, numTurns, usage, modelUsage };
  }

  private shouldRotate(managed: ManagedSession): boolean {
    if (managed.requestCount >= this.maxRequests) {
      logger.info(`[claude-code-v2] Session for ${managed.cwd} exceeded max requests (${managed.requestCount}/${this.maxRequests})`);
      return true;
    }
    if (Date.now() - managed.createdAt >= this.maxAgeMs) {
      const ageHours = (Date.now() - managed.createdAt) / (1000 * 60 * 60);
      logger.info(`[claude-code-v2] Session for ${managed.cwd} exceeded max age (${ageHours.toFixed(1)}h)`);
      return true;
    }
    return false;
  }

  private async closeSession(cwd: string): Promise<void> {
    const managed = this.sessions.get(cwd);
    if (!managed) return;

    try {
      managed.session.close();
    } catch (err) {
      logger.warn(`[claude-code-v2] Error closing session for ${cwd}: ${err}`);
    }

    this.sessions.delete(cwd);
    logger.info(`[claude-code-v2] Session closed for ${cwd}`);
  }
}

// ── Shell Adapter ───────────────────────────────────────────────────────────

class ShellAdapter implements AgentAdapter {
  readonly name = 'shell';
  readonly supportsResume = false;
  private agentCmd: string;

  constructor(agentCmd: string) {
    this.agentCmd = agentCmd;
  }

  async invoke(params: AgentInvocationParams): Promise<AgentInvocationResult> {
    const startTime = Date.now();
    const parts = this.agentCmd.split(/\s+/);
    const cmd = parts[0];
    const args = [...parts.slice(1), params.prompt];

    logger.info(`[shell] Invoking: ${cmd} ${parts.slice(1).join(' ')} <prompt>`);

    try {
      const output = execFileSync(cmd, args, {
        cwd: params.cwd,
        stdio: 'pipe',
        timeout: params.timeout * 1000,
        maxBuffer: 50 * 1024 * 1024,  // 50 MB
      });

      // Send entire output as a single text event if callback provided
      if (params.onOutput && output) {
        params.onOutput({ type: 'text', text: output.toString() });
      }

      return {
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const error = err as { status?: number; stderr?: Buffer };
      const stderr = error.stderr?.toString().trim() ?? '';
      throw new Error(`Shell agent failed (exit ${error.status}): ${stderr || String(err)}`);
    }
  }
}
