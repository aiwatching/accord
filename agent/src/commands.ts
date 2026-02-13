import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from './logger.js';

const VALID_COMMANDS = ['status', 'scan', 'check-inbox', 'validate'] as const;
type ValidCommand = typeof VALID_COMMANDS[number];

export function isValidCommand(cmd: string): cmd is ValidCommand {
  return (VALID_COMMANDS as readonly string[]).includes(cmd);
}

/**
 * Execute a diagnostic command and return the formatted result.
 * These run without an AI agent — pure shell fast-path.
 */
export function executeCommand(command: string, targetDir: string, accordDir: string): string {
  if (!isValidCommand(command)) {
    return `ERROR: Unknown command "${command}". Valid commands: ${VALID_COMMANDS.join(', ')}`;
  }

  try {
    switch (command) {
      case 'status':
        return runStatus(targetDir, accordDir);
      case 'scan':
        return runScan(targetDir, accordDir);
      case 'check-inbox':
        return runCheckInbox(accordDir);
      case 'validate':
        return runValidate(targetDir, accordDir);
    }
  } catch (err) {
    return `ERROR executing "${command}": ${err}`;
  }
}

function runStatus(targetDir: string, accordDir: string): string {
  const lines: string[] = ['## Status Report', ''];

  // Count contracts
  const extDir = path.join(accordDir, 'contracts');
  const intDir = path.join(accordDir, 'contracts', 'internal');
  const extCount = countFiles(extDir, '.yaml');
  const intCount = countFiles(intDir, '.md');
  lines.push(`**Contracts**: ${extCount} external, ${intCount} internal`);

  // Count inbox items
  const inboxDir = path.join(accordDir, 'comms', 'inbox');
  let inboxCount = 0;
  if (fs.existsSync(inboxDir)) {
    for (const sub of fs.readdirSync(inboxDir)) {
      const subPath = path.join(inboxDir, sub);
      if (fs.statSync(subPath).isDirectory()) {
        inboxCount += countFiles(subPath, '.md');
      }
    }
  }
  lines.push(`**Inbox items**: ${inboxCount}`);

  // Count archive items
  const archiveDir = path.join(accordDir, 'comms', 'archive');
  const archiveCount = countFiles(archiveDir, '.md');
  lines.push(`**Archived**: ${archiveCount}`);

  return lines.join('\n');
}

function runScan(targetDir: string, accordDir: string): string {
  const results: string[] = ['## Scan Results', ''];

  // Run validators if they exist
  const validatorsDir = findValidatorsDir();
  if (!validatorsDir) {
    return 'Validators not found. Run from accord repo or install globally.';
  }

  // Validate external contracts
  const extDir = path.join(accordDir, 'contracts');
  if (fs.existsSync(extDir)) {
    for (const file of fs.readdirSync(extDir).filter(f => f.endsWith('.yaml'))) {
      const filePath = path.join(extDir, file);
      try {
        execFileSync('bash', [path.join(validatorsDir, 'validate-openapi.sh'), filePath], {
          stdio: 'pipe', timeout: 10_000,
        });
        results.push(`- ✓ ${file}`);
      } catch (err) {
        const msg = (err as { stderr?: Buffer }).stderr?.toString() || String(err);
        results.push(`- ✗ ${file}: ${msg.trim()}`);
      }
    }
  }

  // Validate internal contracts
  const intDir = path.join(accordDir, 'contracts', 'internal');
  if (fs.existsSync(intDir)) {
    for (const file of fs.readdirSync(intDir).filter(f => f.endsWith('.md'))) {
      const filePath = path.join(intDir, file);
      try {
        execFileSync('bash', [path.join(validatorsDir, 'validate-internal.sh'), filePath], {
          stdio: 'pipe', timeout: 10_000,
        });
        results.push(`- ✓ ${file}`);
      } catch (err) {
        const msg = (err as { stderr?: Buffer }).stderr?.toString() || String(err);
        results.push(`- ✗ ${file}: ${msg.trim()}`);
      }
    }
  }

  return results.join('\n');
}

function runCheckInbox(accordDir: string): string {
  const inboxDir = path.join(accordDir, 'comms', 'inbox');
  if (!fs.existsSync(inboxDir)) return 'No inbox directory found.';

  const lines: string[] = ['## Inbox', '', '| Service | File | Status | Priority | Type |', '|---------|------|--------|----------|------|'];

  for (const sub of fs.readdirSync(inboxDir).sort()) {
    const subPath = path.join(inboxDir, sub);
    if (!fs.statSync(subPath).isDirectory()) continue;

    for (const file of fs.readdirSync(subPath).filter(f => f.startsWith('req-') && f.endsWith('.md')).sort()) {
      const content = fs.readFileSync(path.join(subPath, file), 'utf-8');
      const status = extractField(content, 'status') || '?';
      const priority = extractField(content, 'priority') || '?';
      const type = extractField(content, 'type') || '?';
      lines.push(`| ${sub} | ${file} | ${status} | ${priority} | ${type} |`);
    }
  }

  return lines.join('\n');
}

function runValidate(targetDir: string, accordDir: string): string {
  const results: string[] = ['## Validation Results', ''];

  const validatorsDir = findValidatorsDir();
  if (!validatorsDir) {
    return 'Validators not found.';
  }

  // Validate requests
  const inboxDir = path.join(accordDir, 'comms', 'inbox');
  if (fs.existsSync(inboxDir)) {
    const reqValidator = path.join(validatorsDir, 'validate-request.sh');
    if (fs.existsSync(reqValidator)) {
      for (const sub of fs.readdirSync(inboxDir)) {
        const subPath = path.join(inboxDir, sub);
        if (!fs.statSync(subPath).isDirectory()) continue;
        for (const file of fs.readdirSync(subPath).filter(f => f.endsWith('.md'))) {
          const filePath = path.join(subPath, file);
          try {
            execFileSync('bash', [reqValidator, filePath], { stdio: 'pipe', timeout: 10_000 });
            results.push(`- ✓ ${sub}/${file}`);
          } catch (err) {
            const msg = (err as { stderr?: Buffer }).stderr?.toString() || String(err);
            results.push(`- ✗ ${sub}/${file}: ${msg.trim()}`);
          }
        }
      }
    }
  }

  return results.join('\n');
}

// ── Helpers ────────────────────────────────────────────────────────────────

function countFiles(dir: string, ext: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f => f.endsWith(ext)).length;
}

function extractField(content: string, field: string): string | null {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

function findValidatorsDir(): string | null {
  const candidates = [
    process.env['ACCORD_DIR'] ? path.join(process.env['ACCORD_DIR'], 'protocol', 'scan', 'validators') : null,
    path.join(process.env['HOME'] ?? '', '.accord', 'protocol', 'scan', 'validators'),
    path.resolve(import.meta.dirname, '..', '..', 'protocol', 'scan', 'validators'),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
