// Accord Agent — Execution Planner
//
// Generates a step-by-step execution plan using a lightweight model (default: haiku)
// before the orchestrator agent runs. The user reviews/edits the plan in the UI,
// then the approved plan is injected into the orchestrator prompt.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from './logger.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PlannerParams {
  userMessage: string;
  serviceNames: string[];
  accordDir: string;
  model?: string;
  onOutput?: (chunk: string) => void;
}

export interface PlanResult {
  plan: string;
  costUsd?: number;
}

// ── Planner prompt builder (exported for testing) ───────────────────────────

export function buildPlannerPrompt(userMessage: string, serviceNames: string[], accordDir: string): string {
  // Read registry summaries if available
  const registrySummaries: string[] = [];
  const registryDir = path.join(accordDir, 'registry');
  if (fs.existsSync(registryDir)) {
    for (const name of serviceNames) {
      for (const ext of ['.yaml', '.md']) {
        const filePath = path.join(registryDir, `${name}${ext}`);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          // Extract first few lines for a summary
          const lines = content.split('\n').slice(0, 15).join('\n');
          registrySummaries.push(`### ${name}\n${lines}`);
          break;
        }
      }
    }
  }

  const registrySection = registrySummaries.length > 0
    ? `\n## Service Registry Info\n\n${registrySummaries.join('\n\n')}\n`
    : '';

  return `## Role: Execution Planner

You create step-by-step execution plans for the Accord orchestrator.
Your job is to analyze the user's request and determine which services need work and in what order.

Do NOT execute anything — only produce a plan.

## Available Services

${serviceNames.map(s => `- ${s}`).join('\n')}
${registrySection}
## User Request

${userMessage}

## Output Format

Produce a concise plan in this exact format:

### Execution Plan
1. **service-name** — concrete task description
2. **service-name** — concrete task description
...

### Dependencies
- List any ordering dependencies (e.g., "Task 2 depends on Task 1")
- Write "None" if all tasks are independent

### Expected Outcome
Brief description of what will be achieved when all tasks complete.`;
}

// ── Plan generator ──────────────────────────────────────────────────────────

/** Extract readable text from an SDK assistant message content blocks. */
function extractAssistantText(message: unknown): string {
  if (typeof message === 'string') return message;

  const msg = message as { content?: Array<{ type: string; text?: string }> };
  const blocks = msg?.content;
  if (!Array.isArray(blocks)) return '';

  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

export async function generatePlan(params: PlannerParams): Promise<PlanResult> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const prompt = buildPlannerPrompt(params.userMessage, params.serviceNames, params.accordDir);
  const model = params.model ?? 'claude-haiku-4-5-20251001';

  logger.info(`[planner] Generating plan with ${model}`);

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), 60_000); // 60s hard timeout for plan generation

  try {
    const response = query({
      prompt,
      options: {
        model,
        maxTurns: 1,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController,
      },
    });

    let planText = '';
    let costUsd: number | undefined;

    for await (const msg of response) {
      const m = msg as Record<string, unknown>;

      if (m.type === 'assistant' && m.message) {
        const text = extractAssistantText(m.message);
        if (text) {
          planText += text;
          if (params.onOutput) {
            params.onOutput(text);
          }
        }
      } else if (m.type === 'result') {
        costUsd = m.total_cost_usd as number | undefined;
        if (m.is_error) {
          const errors = m.errors as string[] | undefined;
          throw new Error(`Planner error: ${errors?.join(', ') ?? 'unknown'}`);
        }
        logger.info(`[planner] Plan generated, $${costUsd?.toFixed(4) ?? '?'}`);
      }
    }

    return { plan: planText, costUsd };
  } finally {
    clearTimeout(timer);
  }
}
