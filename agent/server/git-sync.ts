import { execFileSync } from 'node:child_process';
import type { AccordConfig } from './types.js';
import { logger } from './logger.js';

const MAX_PUSH_RETRIES = 3;

function hasUpstream(targetDir: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
      cwd: targetDir,
      stdio: 'pipe',
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

export function syncPull(targetDir: string, _config: AccordConfig): void {
  if (!hasUpstream(targetDir)) {
    logger.debug('No upstream tracking branch — skipping pull');
    return;
  }
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

export function syncPush(targetDir: string, _config: AccordConfig): void {
  if (!hasUpstream(targetDir)) {
    logger.debug('No upstream tracking branch — skipping push');
    return;
  }
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

export function cloneRepo(repoUrl: string, targetDir: string): void {
  execFileSync('git', ['clone', repoUrl, targetDir], {
    stdio: 'pipe',
    timeout: 60_000,
  });
  logger.info(`Cloned ${repoUrl} → ${targetDir}`);
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
