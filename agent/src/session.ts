import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DispatcherConfig, SessionInfo } from './types.js';
import { logger } from './logger.js';

const SESSION_DIR = 'comms/sessions';

export class SessionManager {
  private sessions = new Map<string, SessionInfo>();
  private config: DispatcherConfig;

  constructor(config: DispatcherConfig) {
    this.config = config;
  }

  getSession(serviceName: string): SessionInfo | undefined {
    return this.sessions.get(serviceName);
  }

  createSession(serviceName: string, sessionId: string): SessionInfo {
    const info: SessionInfo = {
      sessionId,
      serviceName,
      createdAt: Date.now(),
      requestCount: 0,
      lastUsedAt: Date.now(),
    };
    this.sessions.set(serviceName, info);
    logger.debug(`Session created for ${serviceName}: ${sessionId}`);
    return info;
  }

  updateSession(serviceName: string, sessionId: string): void {
    const existing = this.sessions.get(serviceName);
    if (existing) {
      existing.sessionId = sessionId;
      existing.requestCount += 1;
      existing.lastUsedAt = Date.now();
    } else {
      const info = this.createSession(serviceName, sessionId);
      info.requestCount = 1;
    }
  }

  shouldRotate(serviceName: string): boolean {
    const session = this.sessions.get(serviceName);
    if (!session) return false;

    if (session.requestCount >= this.config.session_max_requests) {
      logger.info(`Session for ${serviceName} exceeded max requests (${session.requestCount}/${this.config.session_max_requests})`);
      return true;
    }

    const ageHours = (Date.now() - session.createdAt) / (1000 * 60 * 60);
    if (ageHours >= this.config.session_max_age_hours) {
      logger.info(`Session for ${serviceName} exceeded max age (${ageHours.toFixed(1)}h/${this.config.session_max_age_hours}h)`);
      return true;
    }

    return false;
  }

  rotateSession(serviceName: string): void {
    const session = this.sessions.get(serviceName);
    if (session) {
      logger.info(`Rotating session for ${serviceName} (was ${session.sessionId}, ${session.requestCount} requests)`);
      this.sessions.delete(serviceName);
    }
  }

  /**
   * Load session IDs from disk for resume across restarts.
   * Reads .accord/.agent-sessions.json
   */
  loadFromDisk(accordDir: string): void {
    const filePath = path.join(accordDir, '.agent-sessions.json');
    if (!fs.existsSync(filePath)) return;

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, SessionInfo>;
      for (const [svc, info] of Object.entries(data)) {
        this.sessions.set(svc, info);
      }
      logger.info(`Loaded ${this.sessions.size} session(s) from disk`);
    } catch (err) {
      logger.warn(`Failed to load sessions from disk: ${err}`);
    }
  }

  /**
   * Save session IDs to disk for resume across restarts.
   */
  saveToDisk(accordDir: string): void {
    const filePath = path.join(accordDir, '.agent-sessions.json');
    const data: Record<string, SessionInfo> = {};
    for (const [svc, info] of this.sessions) {
      data[svc] = info;
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Write a crash-recovery checkpoint.
   */
  writeCheckpoint(accordDir: string, requestId: string, context: string): void {
    const sessDir = path.join(accordDir, SESSION_DIR);
    fs.mkdirSync(sessDir, { recursive: true });
    const filePath = path.join(sessDir, `${requestId}.session.md`);
    fs.writeFileSync(filePath, context, 'utf-8');
    logger.debug(`Checkpoint written for ${requestId}`);
  }

  /**
   * Read a crash-recovery checkpoint.
   */
  readCheckpoint(accordDir: string, requestId: string): string | null {
    const filePath = path.join(accordDir, SESSION_DIR, `${requestId}.session.md`);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  }

  /**
   * Clear a crash-recovery checkpoint.
   */
  clearCheckpoint(accordDir: string, requestId: string): void {
    const filePath = path.join(accordDir, SESSION_DIR, `${requestId}.session.md`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.debug(`Checkpoint cleared for ${requestId}`);
    }
  }

  getAllSessions(): Map<string, SessionInfo> {
    return new Map(this.sessions);
  }
}
