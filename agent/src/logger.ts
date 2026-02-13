import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LogLevel } from './types.js';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let logStream: fs.WriteStream | null = null;
let minLevel: LogLevel = 'info';

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function timeOnly(): string {
  return new Date().toTimeString().slice(0, 8);
}

function format(level: LogLevel, msg: string): string {
  return `[accord-agent] ${timestamp()} [${level.toUpperCase()}] ${msg}`;
}

function consoleFormat(level: LogLevel, msg: string): string {
  return `[accord-agent] ${timeOnly()} ${msg}`;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function write(level: LogLevel, msg: string): void {
  if (!shouldLog(level)) return;

  const line = format(level, msg);
  if (logStream) {
    logStream.write(line + '\n');
  }

  const consoleLine = consoleFormat(level, msg);
  if (level === 'error') {
    process.stderr.write(consoleLine + '\n');
  } else if (level === 'warn') {
    process.stderr.write(consoleLine + '\n');
  } else {
    process.stdout.write(consoleLine + '\n');
  }
}

export const logger = {
  init(targetDir: string, debug: boolean = false): void {
    minLevel = debug ? 'debug' : 'info';
    const logDir = path.join(targetDir, '.accord', 'log');
    fs.mkdirSync(logDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `agent-${date}.log`);
    logStream = fs.createWriteStream(logFile, { flags: 'a' });
  },

  close(): void {
    if (logStream) {
      logStream.end();
      logStream = null;
    }
  },

  debug(msg: string): void { write('debug', msg); },
  info(msg: string): void { write('info', msg); },
  warn(msg: string): void { write('warn', msg); },
  error(msg: string): void { write('error', msg); },
};
