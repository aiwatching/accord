import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import type { AccordConfig, AccordRequest, RequestFrontmatter, RequestPriority, RequestStatus } from './types.js';
import { getInboxPath } from './config.js';
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
    const parts = filePath.split(path.sep);
    const inboxIdx = parts.indexOf('inbox');
    const serviceName = inboxIdx >= 0 && inboxIdx + 1 < parts.length
      ? parts[inboxIdx + 1]
      : 'unknown';

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

export function scanInboxes(accordDir: string, config: AccordConfig): AccordRequest[] {
  const requests: AccordRequest[] = [];
  const services = config.services;

  for (const svc of services) {
    // Scan service inbox
    const svcInbox = getInboxPath(accordDir, svc.name);
    scanDirectory(svcInbox, requests);

    // Scan module inboxes
    if (svc.modules) {
      for (const mod of svc.modules) {
        const modInbox = getInboxPath(accordDir, mod.name);
        scanDirectory(modInbox, requests);
      }
    }
  }

  // Also scan orchestrator inbox if present
  const orchInbox = getInboxPath(accordDir, 'orchestrator');
  scanDirectory(orchInbox, requests);

  return requests;
}

function scanDirectory(dir: string, results: AccordRequest[]): void {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.startsWith('req-') && f.endsWith('.md'));
  for (const file of files) {
    const req = parseRequest(path.join(dir, file));
    if (req) results.push(req);
  }
}

// ── Filtering & Sorting ────────────────────────────────────────────────────

export function getPendingRequests(requests: AccordRequest[]): AccordRequest[] {
  return requests.filter(r => r.frontmatter.status === 'pending');
}

export function sortByPriority(requests: AccordRequest[]): AccordRequest[] {
  return [...requests].sort((a, b) => {
    const pDiff = PRIORITY_ORDER[a.frontmatter.priority] - PRIORITY_ORDER[b.frontmatter.priority];
    if (pDiff !== 0) return pDiff;
    // Same priority: oldest first
    return new Date(a.frontmatter.created).getTime() - new Date(b.frontmatter.created).getTime();
  });
}
