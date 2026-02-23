import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import type { AccordConfig, AccordRequest, RequestFrontmatter, RequestPriority, RequestStatus, DirectiveState, DirectiveFrontmatter } from './types.js';
import { getInboxPath, getAllAccordDirs, getServiceDir } from './config.js';
import { logger } from './logger.js';

const PRIORITY_ORDER: Record<RequestPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ── Parsing ────────────────────────────────────────────────────────────────

export function parseRequest(filePath: string): AccordRequest | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(raw);
    const fm = data as RequestFrontmatter;

    if (!fm.id || !fm.status) {
      logger.warn(`Skipping ${filePath}: missing id or status`);
      return null;
    }

    // Derive service name from inbox path: .../inbox/{service}/req-*.md
    // For archived requests (comms/archive/), fall back to frontmatter.to
    const parts = filePath.split(path.sep);
    const inboxIdx = parts.indexOf('inbox');
    let serviceName: string;
    if (inboxIdx >= 0 && inboxIdx + 1 < parts.length) {
      serviceName = parts[inboxIdx + 1];
    } else {
      serviceName = fm.to || 'unknown';
    }

    return {
      frontmatter: fm,
      body: content.trim(),
      filePath,
      serviceName,
    };
  } catch (err) {
    logger.error(`Failed to parse ${filePath}: ${err}`);
    return null;
  }
}

// ── Updating ───────────────────────────────────────────────────────────────

export function updateRequestField(filePath: string, field: string, value: string): void {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);
  const newData = { ...data, [field]: value };
  const updated = matter.stringify(content, newData);
  fs.writeFileSync(filePath, updated, 'utf-8');
}

export function setRequestStatus(filePath: string, status: RequestStatus): void {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);
  const newData = { ...data, status, updated: new Date().toISOString() };
  const updated = matter.stringify(content, newData);
  fs.writeFileSync(filePath, updated, 'utf-8');
}

export function incrementAttempts(filePath: string): number {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);
  const current = (data as Record<string, unknown>)['attempts'] as number || 0;
  const next = current + 1;
  const newData = { ...data, attempts: next };
  const updated = matter.stringify(content, newData);
  fs.writeFileSync(filePath, updated, 'utf-8');
  return next;
}

// ── Archiving ──────────────────────────────────────────────────────────────

export function archiveRequest(filePath: string, accordDir: string): string {
  const archiveDir = path.join(accordDir, 'comms', 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });
  const dest = path.join(archiveDir, path.basename(filePath));
  fs.renameSync(filePath, dest);
  logger.debug(`Archived ${path.basename(filePath)} → archive/`);
  return dest;
}

// ── Command result ─────────────────────────────────────────────────────────

export function appendResultSection(filePath: string, result: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const resultSection = `\n\n## Result\n\n\`\`\`\n${result}\n\`\`\`\n\n*Executed by: accord-agent.sh (TypeScript)*\n`;
  fs.writeFileSync(filePath, content + resultSection, 'utf-8');
}

// ── Escalation ─────────────────────────────────────────────────────────────

export function createEscalation(params: {
  accordDir: string;
  originalRequest: AccordRequest;
  error: string;
  serviceName: string;
}): string {
  const { accordDir, originalRequest, error, serviceName } = params;
  // Prefer hub directory for escalation (multi-repo: .accord/hub/ is the hub clone)
  const hubDir = path.join(accordDir, 'hub');
  const baseDir = fs.existsSync(hubDir) ? hubDir : accordDir;
  const orchInbox = path.join(baseDir, 'comms', 'inbox', 'orchestrator');
  fs.mkdirSync(orchInbox, { recursive: true });

  const epoch = Date.now();
  const filename = `req-escalation-${serviceName}-${epoch}.md`;
  const filePath = path.join(orchInbox, filename);

  const content = `---
id: escalation-${serviceName}-${epoch}
from: ${serviceName}
to: orchestrator
scope: external
type: other
priority: high
status: pending
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
originated_from: ${originalRequest.frontmatter.id}
---

## Escalation: Agent processing failed

The following request failed after max attempts:

- **Original request**: ${originalRequest.frontmatter.id}
- **Service**: ${serviceName}
- **Error**: ${error}
- **Attempts**: ${originalRequest.frontmatter.attempts ?? 'unknown'}

### Original Request Body

${originalRequest.body}
`;

  fs.writeFileSync(filePath, content, 'utf-8');
  logger.info(`Escalation created: ${filename}`);
  return filePath;
}

// ── Scanning ───────────────────────────────────────────────────────────────

export function scanInboxes(accordDir: string, config: AccordConfig, hubDir?: string): AccordRequest[] {
  const requests: AccordRequest[] = [];
  const services = config.services;

  // Determine all directories to scan (multi-team hubs may have root + team)
  const dirs = hubDir ? getAllAccordDirs(hubDir, config) : [accordDir];

  // Only deduplicate when scanning multiple directories (same request in root + team)
  const seen = dirs.length > 1 ? new Set<string>() : undefined;

  for (const dir of dirs) {
    for (const svc of services) {
      const svcInbox = getInboxPath(dir, svc.name);
      scanDirectory(svcInbox, requests, seen);
    }

    // Also scan orchestrator inbox if present
    const orchInbox = getInboxPath(dir, 'orchestrator');
    scanDirectory(orchInbox, requests, seen);

    // Also scan _team inbox for cross-team requests
    const teamInbox = getInboxPath(dir, '_team');
    scanDirectory(teamInbox, requests, seen);
  }

  return requests;
}

function isRequestFile(filename: string): boolean {
  return filename.startsWith('req-') && filename.endsWith('.md')
    && !filename.endsWith('.summary.md')
    && !filename.endsWith('.resolution.md')
    && !filename.endsWith('.session.md');
}

function scanDirectory(dir: string, results: AccordRequest[], seen?: Set<string>): void {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(isRequestFile);
  for (const file of files) {
    const req = parseRequest(path.join(dir, file));
    if (req) {
      // Deduplicate by request ID (same request may exist in root + team inboxes)
      if (seen && seen.has(req.frontmatter.id)) continue;
      if (seen) seen.add(req.frontmatter.id);
      results.push(req);
    }
  }
}

// ── Archive scanning ──────────────────────────────────────────────────────

/**
 * Scan archive directories for completed/failed requests.
 * For orchestrator hubs, also scans service-level archives (multi-repo agents
 * may archive requests in their own comms/archive/ directory).
 */
export function scanArchives(accordDir: string, config: AccordConfig, hubDir?: string): AccordRequest[] {
  const results: AccordRequest[] = [];
  const seen = new Set<string>();

  // 1. Scan hub-level archive(s)
  const dirs = hubDir ? getAllAccordDirs(hubDir, config) : [accordDir];
  for (const dir of dirs) {
    const archiveDir = path.join(dir, 'comms', 'archive');
    scanDirectory(archiveDir, results, seen);
  }

  // 2. For multi-repo orchestrator, also scan each service's archive
  //    (agents running locally may archive to {serviceDir}/comms/archive/)
  if (hubDir && config.repo_model === 'multi-repo') {
    for (const svc of config.services) {
      const svcDir = path.resolve(getServiceDir(config, svc.name, hubDir));
      if (svcDir === hubDir) continue; // monorepo — already scanned
      const svcArchive = path.join(svcDir, 'comms', 'archive');
      scanDirectory(svcArchive, results, seen);
    }
  }

  return results;
}

// ── Dependency Checking ─────────────────────────────────────────────────────

/**
 * Check if a request's depends_on_requests are all completed.
 */
export function isRequestCompleted(accordDir: string, requestId: string): boolean {
  const archiveDir = path.join(accordDir, 'comms', 'archive');
  if (!fs.existsSync(archiveDir)) return false;

  const files = fs.readdirSync(archiveDir).filter(isRequestFile);
  for (const file of files) {
    const filePath = path.join(archiveDir, file);
    const req = parseRequest(filePath);
    if (req && req.frontmatter.id === requestId && req.frontmatter.status === 'completed') {
      return true;
    }
  }
  return false;
}

/**
 * Get the dependency status for a request.
 * Returns which dependencies are ready and which are still pending.
 */
export function getDependencyStatus(request: AccordRequest, accordDir: string): { ready: boolean; pending: string[] } {
  const deps = request.frontmatter.depends_on_requests;
  if (!deps || deps.length === 0) {
    return { ready: true, pending: [] };
  }

  const pending: string[] = [];
  for (const depId of deps) {
    if (!isRequestCompleted(accordDir, depId)) {
      pending.push(depId);
    }
  }

  return { ready: pending.length === 0, pending };
}

// ── Crash recovery ──────────────────────────────────────────────────────────

/**
 * On hub startup, reset any in-progress requests back to pending.
 * These are requests that were being processed when the hub crashed/restarted.
 * Returns the number of recovered requests.
 */
export function recoverStaleRequests(accordDir: string, config: AccordConfig, hubDir?: string): number {
  const allRequests = scanInboxes(accordDir, config, hubDir);
  let recovered = 0;

  for (const req of allRequests) {
    if (req.frontmatter.status === 'in-progress') {
      try {
        setRequestStatus(req.filePath, 'pending');
        recovered++;
        logger.info(`Recovered stale request: ${req.frontmatter.id} (was in-progress → pending)`);
      } catch (err) {
        logger.warn(`Failed to recover request ${req.frontmatter.id}: ${err}`);
      }
    }
  }

  return recovered;
}

// ── Filtering & Sorting ────────────────────────────────────────────────────

export function getPendingRequests(requests: AccordRequest[]): AccordRequest[] {
  return requests.filter(r => r.frontmatter.status === 'pending');
}

export function getDispatchableRequests(requests: AccordRequest[]): AccordRequest[] {
  return requests.filter(r =>
    r.frontmatter.status === 'pending' || r.frontmatter.status === 'in-progress'
  );
}

export function sortByPriority(requests: AccordRequest[]): AccordRequest[] {
  return [...requests].sort((a, b) => {
    const pDiff = PRIORITY_ORDER[a.frontmatter.priority] - PRIORITY_ORDER[b.frontmatter.priority];
    if (pDiff !== 0) return pDiff;
    // Same priority: oldest first
    return new Date(a.frontmatter.created).getTime() - new Date(b.frontmatter.created).getTime();
  });
}

// ── Directive scanning ──────────────────────────────────────────────────────

/**
 * Read all directive files from the directives/ directory.
 */
export function scanDirectives(accordDir: string): DirectiveState[] {
  const directivesDir = path.join(accordDir, 'directives');
  if (!fs.existsSync(directivesDir)) return [];

  const files = fs.readdirSync(directivesDir).filter(f => f.endsWith('.md'));
  const results: DirectiveState[] = [];

  for (const file of files) {
    const filePath = path.join(directivesDir, file);
    const state = parseDirective(filePath);
    if (state) results.push(state);
  }

  return results;
}

/**
 * Parse a single directive file into DirectiveState.
 */
export function parseDirective(filePath: string): DirectiveState | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(raw);
    const fm = data as DirectiveFrontmatter;

    if (!fm.id || !fm.status) {
      logger.warn(`Skipping directive ${filePath}: missing id or status`);
      return null;
    }

    // Ensure arrays exist
    if (!fm.requests) fm.requests = [];
    if (!fm.contract_proposals) fm.contract_proposals = [];
    if (!fm.test_requests) fm.test_requests = [];

    return {
      frontmatter: fm,
      body: content.trim(),
      filePath,
    };
  } catch (err) {
    logger.error(`Failed to parse directive ${filePath}: ${err}`);
    return null;
  }
}

/**
 * Collect the current status of all requests belonging to a directive.
 * Scans both inboxes (pending/in-progress) and archives (completed/failed).
 *
 * Uses two sources of truth:
 * 1. The directive's own requests/contract_proposals/test_requests arrays (knownRequestIds)
 * 2. Any request whose frontmatter.directive matches the directiveId
 */
export function getDirectiveRequestStatuses(
  accordDir: string,
  config: AccordConfig,
  directiveId: string,
  hubDir?: string,
  knownRequestIds?: string[],
): Map<string, RequestStatus> {
  const statuses = new Map<string, RequestStatus>();
  const knownIds = knownRequestIds ? new Set(knownRequestIds) : undefined;

  // Build a single index of all requests (inbox + archive)
  const allRequests = [
    ...scanInboxes(accordDir, config, hubDir),
    ...scanArchives(accordDir, config, hubDir),
  ];

  for (const req of allRequests) {
    const matchByDirectiveField = req.frontmatter.directive === directiveId;
    const matchByKnownId = knownIds?.has(req.frontmatter.id);

    if (matchByDirectiveField || matchByKnownId) {
      statuses.set(req.frontmatter.id, req.frontmatter.status);
    }
  }

  // Mark any known IDs not found in inbox/archive as 'pending' (not yet created or lost)
  if (knownIds) {
    for (const id of knownIds) {
      if (!statuses.has(id)) {
        statuses.set(id, 'pending');
      }
    }
  }

  return statuses;
}
