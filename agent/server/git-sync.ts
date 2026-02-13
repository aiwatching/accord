import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { AccordConfig } from './types.js';
import { logger } from './logger.js';

const MAX_PUSH_RETRIES = 3;

/**
 * Find the accord-sync.sh script.
 * Checks: ACCORD_DIR env, ~/.accord/, same directory as this script.
 */
function findSyncScript(): string | null {
  const candidates = [
    process.env['ACCORD_DIR'] ? path.join(process.env['ACCORD_DIR'], 'accord-sync.sh') : null,
    path.join(process.env['HOME'] ?? '', '.accord', 'accord-sync.sh'),
    path.resolve(import.meta.dirname, '..', '..', 'accord-sync.sh'),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function syncPull(targetDir: string, config: AccordConfig): void {
  if (config.repo_model === 'multi-repo') {
    const script = findSyncScript();
    if (script) {
      try {
        logger.debug(`Sync pull via ${script}`);
        execFileSync('bash', [script, 'pull', '--target-dir', targetDir], {
          cwd: targetDir,
          stdio: 'pipe',
          timeout: 30_000,
        });
        return;
      } catch (err) {
        logger.warn(`Sync pull failed: ${err}`);
        return;
      }
    }
  }

  // Monorepo or no sync script: simple git pull
  try {
    execFileSync('git', ['pull', '--rebase', '--autostash'], {
      cwd: targetDir,
      stdio: 'pipe',
      timeout: 30_000,
    });
    logger.debug('Git pull completed');
  } catch (err) {
    logger.warn(`Git pull failed: ${err}`);
  }
}

export function syncPush(targetDir: string, config: AccordConfig): void {
  if (config.repo_model === 'multi-repo') {
    const script = findSyncScript();
    if (script) {
      try {
        logger.debug(`Sync push via ${script}`);
        execFileSync('bash', [script, 'push', '--target-dir', targetDir], {
          cwd: targetDir,
          stdio: 'pipe',
          timeout: 30_000,
        });
        return;
      } catch (err) {
        logger.warn(`Sync push failed: ${err}`);
        return;
      }
    }
  }

  // Monorepo: git push with retry
  for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
    try {
      execFileSync('git', ['push'], {
        cwd: targetDir,
        stdio: 'pipe',
        timeout: 30_000,
      });
      logger.debug('Git push completed');
      return;
    } catch {
      if (attempt < MAX_PUSH_RETRIES) {
        logger.warn(`Push failed (attempt ${attempt}/${MAX_PUSH_RETRIES}), pulling and retrying...`);
        try {
          execFileSync('git', ['pull', '--rebase', '--autostash'], {
            cwd: targetDir,
            stdio: 'pipe',
            timeout: 30_000,
          });
        } catch {
          // pull failed too, try push again anyway
        }
      } else {
        logger.error(`Push failed after ${MAX_PUSH_RETRIES} attempts`);
      }
    }
  }
}

export function gitCommit(targetDir: string, message: string): boolean {
  try {
    execFileSync('git', ['add', '-A'], {
      cwd: targetDir,
      stdio: 'pipe',
      timeout: 10_000,
    });

    // Check if there's anything to commit
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: targetDir,
      stdio: 'pipe',
      timeout: 10_000,
    }).toString().trim();

    if (!status) {
      logger.debug('Nothing to commit');
      return false;
    }

    execFileSync('git', ['commit', '-m', message], {
      cwd: targetDir,
      stdio: 'pipe',
      timeout: 10_000,
    });
    logger.debug(`Committed: ${message}`);
    return true;
  } catch (err) {
    logger.warn(`Git commit failed: ${err}`);
    return false;
  }
}
