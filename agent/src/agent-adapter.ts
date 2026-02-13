// Agent Adapter — abstraction layer for AI agent invocations.
//
// Allows the dispatcher to work with different agent backends:
//   - claude-code: Claude Agent SDK (native, supports session resume)
//   - shell: any CLI agent via child_process (e.g. "claude -p", "codex", custom scripts)
//
// To add a new adapter:
//   1. Implement the AgentAdapter interface
//   2. Register it in createAdapter()
//   3. Add the adapter name to AgentAdapterType

import { execFileSync } from 'node:child_process';
import { logger } from './logger.js';

// ── Types ───────────────────────────────────────────────────────────────────

export type AgentAdapterType = 'claude-code' | 'shell';

export interface AgentInvocationParams {
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
  timeout: number;        // seconds
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
}

export interface AgentInvocationResult {
  sessionId?: string;
  costUsd?: number;
  numTurns?: number;
  durationMs: number;
}

export interface AgentAdapter {
  /** Adapter identifier (e.g. "claude-code", "shell") */
  readonly name: string;

  /** Whether this adapter supports session resume across requests */
  readonly supportsResume: boolean;

  /** Invoke the agent with the given prompt and parameters */
  invoke(params: AgentInvocationParams): Promise<AgentInvocationResult>;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export interface AdapterConfig {
  agent: AgentAdapterType;
  agent_cmd?: string;   // for shell adapter
  model?: string;       // default model
}

/**
 * Create an agent adapter based on config.
 *
 * Resolution order:
 *   1. dispatcher.agent in config.yaml
 *   2. Default: "claude-code"
 *
 * For "shell" adapter, agent_cmd is required. Resolution:
 *   1. dispatcher.agent_cmd in config.yaml
 *   2. settings.agent_cmd in config.yaml
 *   3. Default: "claude --dangerously-skip-permissions -p"
 */
export function createAdapter(config: AdapterConfig): AgentAdapter {
  switch (config.agent) {
    case 'claude-code':
      return new ClaudeCodeAdapter(config.model);

    case 'shell':
      return new ShellAdapter(
        config.agent_cmd ?? 'claude --dangerously-skip-permissions -p',
      );

    default:
      throw new Error(`Unknown agent adapter: ${config.agent}. Supported: claude-code, shell`);
  }
}

// ── Claude Code Adapter ─────────────────────────────────────────────────────

class ClaudeCodeAdapter implements AgentAdapter {
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

      for await (const msg of response) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          sessionId = msg.session_id;
          logger.debug(`[claude-code] Session started: ${sessionId}`);
        } else if (msg.type === 'result') {
          sessionId = msg.session_id;
          costUsd = msg.total_cost_usd;
          numTurns = msg.num_turns;

          if (msg.is_error) {
            const errors = (msg as Record<string, unknown>).errors as string[] | undefined;
            throw new Error(`Agent error (${msg.subtype}): ${errors?.join(', ') ?? 'unknown'}`);
          }

          logger.info(`[claude-code] Completed: ${numTurns} turns, $${costUsd?.toFixed(4)}`);
        }
      }

      return {
        sessionId,
        costUsd,
        numTurns,
        durationMs: Date.now() - startTime,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Shell Adapter ───────────────────────────────────────────────────────────

/**
 * Wraps any CLI agent that accepts a prompt via command-line argument.
 *
 * The agent command is invoked as: <agent_cmd> <prompt>
 * Example: "claude --dangerously-skip-permissions -p" <prompt>
 *          "codex -q" <prompt>
 *
 * Does NOT support session resume — each invocation is independent.
 */
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
      execFileSync(cmd, args, {
        cwd: params.cwd,
        stdio: 'pipe',
        timeout: params.timeout * 1000,
        maxBuffer: 50 * 1024 * 1024,  // 50 MB
      });

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
