import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AccordRequest, RequestResult } from './types.js';
import { logger } from './logger.js';

/**
 * Build the full prompt for the Claude Agent SDK invocation.
 */
export function buildAgentPrompt(params: {
  request: AccordRequest;
  serviceName: string;
  targetDir: string;
  accordDir: string;
  checkpoint?: string;
}): string {
  const { request, serviceName, targetDir, accordDir, checkpoint } = params;
  const sections: string[] = [];

  // 1. Role header
  sections.push(`You are the Accord agent for the "${serviceName}" service.`);
  sections.push(`Your working directory is: ${targetDir}`);
  sections.push('');

  // 2. Full request content
  sections.push('## Request to Process');
  sections.push('');
  sections.push(`**File**: ${request.filePath}`);
  sections.push(`**ID**: ${request.frontmatter.id}`);
  sections.push(`**From**: ${request.frontmatter.from}`);
  sections.push(`**To**: ${request.frontmatter.to}`);
  sections.push(`**Type**: ${request.frontmatter.type}`);
  sections.push(`**Scope**: ${request.frontmatter.scope}`);
  sections.push(`**Priority**: ${request.frontmatter.priority}`);
  sections.push('');
  sections.push(request.body);
  sections.push('');

  // 3. Service context — inline registry files if present
  const registryDir = path.join(accordDir, 'registry');
  const registryFile = path.join(registryDir, `${serviceName}.md`);
  if (fs.existsSync(registryFile)) {
    sections.push('## Service Registry');
    sections.push('');
    sections.push(fs.readFileSync(registryFile, 'utf-8'));
    sections.push('');
  }

  // 4. Related contract path
  if (request.frontmatter.related_contract) {
    const contractPath = path.join(accordDir, request.frontmatter.related_contract);
    if (fs.existsSync(contractPath)) {
      sections.push('## Related Contract');
      sections.push('');
      sections.push(`File: ${contractPath}`);
      sections.push('');
      sections.push(fs.readFileSync(contractPath, 'utf-8'));
      sections.push('');
    }
  }

  // 5. Skills section
  const skillIndex = loadSkillIndex(targetDir);
  if (skillIndex) {
    sections.push('## Available Skills');
    sections.push('');
    sections.push(skillIndex);
    sections.push('');
  }

  // 6. Checkpoint context for crash recovery
  if (checkpoint) {
    sections.push('## Previous Session Context (Crash Recovery)');
    sections.push('');
    sections.push(checkpoint);
    sections.push('');
  }

  // 7. Instructions
  sections.push('## Instructions');
  sections.push('');
  sections.push('1. Implement the requested changes in the codebase.');
  sections.push('2. If the request requires a contract update, update the relevant contract file.');
  sections.push(`3. When done, update the request status to "completed" by editing the frontmatter in: ${request.filePath}`);
  sections.push(`4. Move the completed request to the archive: ${path.join(accordDir, 'comms', 'archive', path.basename(request.filePath))}`);
  sections.push('5. Commit all changes with a descriptive message prefixed with "accord: ".');
  sections.push('6. Do NOT push to the remote repository — the dispatcher handles push.');
  sections.push('');

  return sections.join('\n');
}

/**
 * Load the skill index file if it exists.
 * Checks .accord/skills, then .claude/skills.
 */
function loadSkillIndex(targetDir: string): string | null {
  const candidates = [
    path.join(targetDir, '.accord', 'skills', 'SKILL-INDEX.md'),
    path.join(targetDir, '.claude', 'skills', 'SKILL-INDEX.md'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return fs.readFileSync(c, 'utf-8');
    }
  }
  return null;
}

/**
 * Build a session summary from processed results (for CLAUDE.md context on rotation).
 */
export function buildSessionSummary(results: RequestResult[]): string {
  if (results.length === 0) return '';

  const lines = ['## Agent Session Summary', ''];
  for (const r of results) {
    const status = r.success ? 'completed' : 'failed';
    const cost = r.costUsd ? ` ($${r.costUsd.toFixed(4)})` : '';
    const turns = r.numTurns ? ` (${r.numTurns} turns)` : '';
    lines.push(`- ${r.requestId}: ${status}${cost}${turns}`);
  }
  return lines.join('\n');
}
