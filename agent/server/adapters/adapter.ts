// Agent Adapter — abstraction layer for AI agent invocations.
//
// Allows the dispatcher to work with different agent backends:
//   - claude-code: Claude Agent SDK (native, supports session resume + streaming)
//   - shell: any CLI agent via child_process (e.g. "claude -p", "codex", custom scripts)

import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { logger } from '../logger.js';

// Ensure the current node binary's directory is in PATH.
// The Claude Agent SDK spawns `node` as a child process; if the server
// was started from a context with a limited PATH (IDE, daemon, launchd),
// `node` may not be found.  Fix once at module load time.
const nodeDir = path.dirname(process.execPath);
if (!process.env.PATH?.includes(nodeDir)) {
  process.env.PATH = `${nodeDir}${path.delimiter}${process.env.PATH ?? ''}`;
}

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
  /** Streaming callback — receives text chunks as the agent produces output. */
  onOutput?: (chunk: string) => void;
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
      return new ClaudeCodeV1Adapter(config.model);

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

/** Extract readable text from an SDK assistant message content blocks. */
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

// ── Claude Code Adapter ─────────────────────────────────────────────────────

class ClaudeCodeV1Adapter implements AgentAdapter {
  readonly name = 'claude-code';
  readonly supportsResume = true;
  private defaultModel?: string;

  constructor(defaultModel?: string) {
    this.defaultModel = defaultModel;
  }

  async invoke(params: AgentInvocationParams): Promise<AgentInvocationResult> {
    // Dynamic import — keeps the SDK optional (tests can run without it)
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), params.timeout * 1000);
    const startTime = Date.now();

    try {
      const response = query({
        prompt: params.prompt,
        options: {
          model: params.model ?? this.defaultModel ?? 'claude-sonnet-4-5-20250929',
          resume: params.resumeSessionId,
          cwd: params.cwd,
          allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          maxTurns: params.maxTurns ?? 50,
          maxBudgetUsd: params.maxBudgetUsd,
          abortController,
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          settingSources: ['project'],
        },
      });

      let sessionId: string | undefined;
      let costUsd: number | undefined;
      let numTurns: number | undefined;
      let usage: TokenUsage | undefined;
      let modelUsage: Record<string, ModelUsageEntry> | undefined;

      for await (const msg of response) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          sessionId = msg.session_id;
        } else if (msg.type === 'assistant' && msg.message) {
          // Output text from each assistant turn
          const text = extractAssistantText(msg.message);
          if (text && params.onOutput) {
            params.onOutput(text);
          }
        } else if (msg.type === 'result') {
          sessionId = msg.session_id;
          costUsd = msg.total_cost_usd;
          numTurns = msg.num_turns;

          // Capture token-level usage data
          const resultAny = msg as Record<string, unknown>;
          if (resultAny.usage) {
            const u = resultAny.usage as Record<string, number>;
            usage = {
              input_tokens: u.input_tokens ?? 0,
              output_tokens: u.output_tokens ?? 0,
              cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
              cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
            };
          }
          if (resultAny.modelUsage) {
            modelUsage = resultAny.modelUsage as Record<string, ModelUsageEntry>;
          }

          if (msg.is_error) {
            const errors = resultAny.errors as string[] | undefined;
            throw new Error(`Agent error (${msg.subtype}): ${errors?.join(', ') ?? 'unknown'}`);
          }

          logger.info(`[claude-code] Completed: ${numTurns} turns, $${costUsd?.toFixed(4)}, input=${usage?.input_tokens ?? '?'}, output=${usage?.output_tokens ?? '?'}, cache_read=${usage?.cache_read_input_tokens ?? '?'}`);
        }
      }

      return {
        sessionId,
        costUsd,
        numTurns,
        durationMs: Date.now() - startTime,
        usage,
        modelUsage,
      };
    } finally {
      clearTimeout(timer);
    }
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
    onOutput?: (chunk: string) => void,
  ): Promise<Omit<AgentInvocationResult, 'durationMs'>> {
    let sessionId: string | undefined;
    let costUsd: number | undefined;
    let numTurns: number | undefined;
    let usage: TokenUsage | undefined;
    let modelUsage: Record<string, ModelUsageEntry> | undefined;

    while (true) {
      const { value: msg, done } = await managed.activeStream.next();
      if (done || !msg) break;

      const m = msg as Record<string, unknown>;

      if (m.type === 'system' && m.subtype === 'init') {
        sessionId = m.session_id as string | undefined;
        if (sessionId) managed.sessionId = sessionId;
      } else if (m.type === 'assistant' && m.message) {
        const text = extractAssistantText(m.message);
        if (text && onOutput) {
          onOutput(text);
        }
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

      // Send entire output as a single chunk if callback provided
      if (params.onOutput && output) {
        params.onOutput(output.toString());
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
