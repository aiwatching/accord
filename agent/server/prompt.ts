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

  // 3. Service context — inline registry files if present (try .yaml first, then .md)
  const registryDir = path.join(accordDir, 'registry');
  const registryYaml = path.join(registryDir, `${serviceName}.yaml`);
  const registryMd = path.join(registryDir, `${serviceName}.md`);
  const registryFile = fs.existsSync(registryYaml) ? registryYaml : registryMd;
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

// ── Coordination prompt builders ─────────────────────────────────────────────

/**
 * Build the body for a contract-proposal request file.
 */
export function buildContractProposalBody(params: {
  directiveTitle: string;
  targetService: string;
  contractPath: string;
  proposedInterface: string;
  relatedServices: string[];
}): string {
  const { directiveTitle, targetService, contractPath, proposedInterface, relatedServices } = params;
  const sections: string[] = [];

  sections.push(`## Proposed Contract Change`);
  sections.push('');
  sections.push(`**Directive**: ${directiveTitle}`);
  sections.push(`**Target Service**: ${targetService}`);
  sections.push(`**Contract**: ${contractPath}`);
  if (relatedServices.length > 0) {
    sections.push(`**Related Services**: ${relatedServices.join(', ')}`);
  }
  sections.push('');
  sections.push('### Proposed Interface');
  sections.push('');
  sections.push(proposedInterface);
  sections.push('');
  sections.push('## Instructions');
  sections.push('');
  sections.push('- Review the proposed contract change above.');
  sections.push('- If you **accept**: update the contract file and mark this request as `completed`.');
  sections.push('- If you **reject**: mark this request as `rejected` and explain the reason in the body.');
  sections.push('');

  return sections.join('\n');
}

/**
 * Build the body for a test request file.
 */
export function buildTestRequestBody(params: {
  directiveTitle: string;
  services: string[];
  contracts: string[];
  implementationSummary: string;
}): string {
  const { directiveTitle, services, contracts, implementationSummary } = params;
  const sections: string[] = [];

  sections.push(`## Integration Test Request`);
  sections.push('');
  sections.push(`**Directive**: ${directiveTitle}`);
  sections.push(`**Modified Services**: ${services.join(', ')}`);
  if (contracts.length > 0) {
    sections.push(`**Updated Contracts**: ${contracts.join(', ')}`);
  }
  sections.push('');
  sections.push('### Implementation Summary');
  sections.push('');
  sections.push(implementationSummary);
  sections.push('');
  sections.push('## Test Instructions');
  sections.push('');
  sections.push('1. Verify cross-service interface alignment based on the updated contracts.');
  sections.push('2. Run integration tests covering the modified services.');
  sections.push('3. If all tests pass: mark this request as `completed`.');
  sections.push('4. If any test fails: mark this request as `failed` and include detailed failure reasons in the body.');
  sections.push('');

  return sections.join('\n');
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
