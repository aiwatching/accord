#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, getDispatcherConfig, getServiceNames, getServiceDir, getAccordDir } from './config.js';
import { Dispatcher } from './dispatcher.js';
import { logger } from './logger.js';

// ── CLI argument parsing ───────────────────────────────────────────────────

interface CLIArgs {
  command: string;
  targetDir: string;
  workers?: number;
  interval?: number;
  timeout?: number;
  agentCmd?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    command: '',
    targetDir: process.cwd(),
    dryRun: false,
  };

  let i = 0;
  // Skip 'node' and script path
  while (i < argv.length) {
    const arg = argv[i];
    if (!args.command && !arg.startsWith('-')) {
      args.command = arg;
      i++;
      continue;
    }

    switch (arg) {
      case '--target-dir':
        args.targetDir = path.resolve(argv[++i] ?? '.');
        break;
      case '--workers':
        args.workers = parseInt(argv[++i] ?? '4', 10);
        break;
      case '--interval':
        args.interval = parseInt(argv[++i] ?? '30', 10);
        break;
      case '--timeout':
        args.timeout = parseInt(argv[++i] ?? '600', 10);
        break;
      case '--agent-cmd':
        args.agentCmd = argv[++i] ?? '';
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        if (!arg.startsWith('-') && !args.command) {
          args.command = arg;
        }
        break;
    }
    i++;
  }

  return args;
}

function printUsage(): void {
  console.log(`
Usage: accord-agent <command> [options]

Autonomous request processing daemon for Accord services.
TypeScript dispatcher with worker pool, powered by Claude Agent SDK.

Commands:
  start       Start the agent daemon (background)
  stop        Stop the agent daemon
  status      Show daemon status
  run-once    Process requests once, then exit
  start-all   Start agents for all services (from hub)
  stop-all    Stop agents for all services (from hub)
  status-all  Show status dashboard for all services

Options:
  --target-dir <path>     Project directory (default: current directory)
  --workers <N>           Number of concurrent workers (default: 4)
  --interval <seconds>    Polling interval for start (default: 30)
  --timeout <seconds>     Per-request timeout (default: 600)
  --agent-cmd <cmd>       Shell command to use as agent (instead of Claude SDK)
  --dry-run               Show what would be processed without executing
  --help                  Show this help message
`);
}

// ── PID management ─────────────────────────────────────────────────────────

function getPidFile(targetDir: string): string {
  return path.join(targetDir, '.accord', '.agent.pid');
}

function writePid(targetDir: string): void {
  const pidFile = getPidFile(targetDir);
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, String(process.pid), 'utf-8');
}

function readPid(targetDir: string): number | null {
  const pidFile = getPidFile(targetDir);
  if (!fs.existsSync(pidFile)) return null;
  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
  return isNaN(pid) ? null : pid;
}

function removePid(targetDir: string): void {
  const pidFile = getPidFile(targetDir);
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── Commands ───────────────────────────────────────────────────────────────

async function doStart(args: CLIArgs): Promise<void> {
  const existingPid = readPid(args.targetDir);
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(`Already running (PID ${existingPid})`);
    process.exit(0);
  }

  const config = loadConfig(args.targetDir);
  const dispatcherConfig = getDispatcherConfig(config);

  // Apply CLI overrides
  if (args.workers) dispatcherConfig.workers = args.workers;
  if (args.interval) dispatcherConfig.poll_interval = args.interval;
  if (args.timeout) dispatcherConfig.request_timeout = args.timeout;
  if (args.agentCmd) {
    dispatcherConfig.agent = 'shell';
    dispatcherConfig.agent_cmd = args.agentCmd;
  }

  logger.init(args.targetDir, dispatcherConfig.debug);
  writePid(args.targetDir);

  // Graceful shutdown
  const cleanup = () => {
    logger.info('Shutting down...');
    dispatcher.stop();
    removePid(args.targetDir);
    logger.close();
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  const dispatcher = new Dispatcher(dispatcherConfig, config, args.targetDir);
  await dispatcher.start(args.interval);
}

async function doStop(args: CLIArgs): Promise<void> {
  const pid = readPid(args.targetDir);
  if (!pid) {
    console.log('Not running');
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log(`Agent PID ${pid} not running (stale PID file). Cleaning up.`);
    removePid(args.targetDir);
    return;
  }

  process.kill(pid, 'SIGTERM');
  console.log(`Sent SIGTERM to agent (PID ${pid})`);
  removePid(args.targetDir);
}

async function doStatus(args: CLIArgs): Promise<void> {
  const pid = readPid(args.targetDir);
  if (!pid) {
    console.log('Not running');
    return;
  }

  if (isProcessRunning(pid)) {
    console.log(`Running (PID ${pid})`);
  } else {
    console.log(`Not running (stale PID ${pid})`);
    removePid(args.targetDir);
  }
}

async function doRunOnce(args: CLIArgs): Promise<void> {
  const config = loadConfig(args.targetDir);
  const dispatcherConfig = getDispatcherConfig(config);

  if (args.workers) dispatcherConfig.workers = args.workers;
  if (args.timeout) dispatcherConfig.request_timeout = args.timeout;
  if (args.agentCmd) {
    dispatcherConfig.agent = 'shell';
    dispatcherConfig.agent_cmd = args.agentCmd;
  }

  logger.init(args.targetDir, dispatcherConfig.debug);

  const dispatcher = new Dispatcher(dispatcherConfig, config, args.targetDir);
  const count = await dispatcher.runOnce(args.dryRun);

  if (args.dryRun) {
    console.log(`Dry run: ${count} request(s) would be processed`);
  } else {
    console.log(`Processed ${count} request(s)`);
  }

  logger.close();
}

async function doStartAll(args: CLIArgs): Promise<void> {
  const config = loadConfig(args.targetDir);
  const services = getServiceNames(config);

  console.log(`Starting agents for ${services.length} service(s)...`);

  for (const svc of services) {
    const serviceDir = getServiceDir(config, svc, args.targetDir);
    if (!fs.existsSync(serviceDir)) {
      console.log(`  ${svc}: directory not found (${serviceDir}), skipping`);
      continue;
    }

    // Spawn a child process for each service
    const child = spawn(
      process.execPath,
      [
        path.resolve(import.meta.dirname, 'index.js'),
        'start',
        '--target-dir', serviceDir,
        ...(args.workers ? ['--workers', String(args.workers)] : []),
        ...(args.interval ? ['--interval', String(args.interval)] : []),
        ...(args.timeout ? ['--timeout', String(args.timeout)] : []),
        ...(args.agentCmd ? ['--agent-cmd', args.agentCmd] : []),
      ],
      {
        detached: true,
        stdio: 'ignore',
      }
    );
    child.unref();

    console.log(`  ${svc}: started (PID ${child.pid})`);
  }
}

async function doStopAll(args: CLIArgs): Promise<void> {
  const config = loadConfig(args.targetDir);
  const services = getServiceNames(config);

  console.log(`Stopping agents for ${services.length} service(s)...`);

  for (const svc of services) {
    const serviceDir = getServiceDir(config, svc, args.targetDir);
    const pid = readPid(serviceDir);
    if (!pid) {
      console.log(`  ${svc}: not running`);
      continue;
    }

    if (isProcessRunning(pid)) {
      process.kill(pid, 'SIGTERM');
      console.log(`  ${svc}: stopped (PID ${pid})`);
    } else {
      console.log(`  ${svc}: not running (stale PID)`);
    }
    removePid(serviceDir);
  }
}

async function doStatusAll(args: CLIArgs): Promise<void> {
  const config = loadConfig(args.targetDir);
  const services = getServiceNames(config);

  console.log(`Agent status for ${services.length} service(s):\n`);
  console.log('| Service | Status | PID |');
  console.log('|---------|--------|-----|');

  for (const svc of services) {
    const serviceDir = getServiceDir(config, svc, args.targetDir);
    const pid = readPid(serviceDir);

    if (!pid) {
      console.log(`| ${svc} | stopped | - |`);
    } else if (isProcessRunning(pid)) {
      console.log(`| ${svc} | running | ${pid} |`);
    } else {
      console.log(`| ${svc} | stale | ${pid} |`);
      removePid(serviceDir);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command) {
    printUsage();
    process.exit(1);
  }

  switch (args.command) {
    case 'start':
      await doStart(args);
      break;
    case 'stop':
      await doStop(args);
      break;
    case 'status':
      await doStatus(args);
      break;
    case 'run-once':
      await doRunOnce(args);
      break;
    case 'start-all':
      await doStartAll(args);
      break;
    case 'stop-all':
      await doStopAll(args);
      break;
    case 'status-all':
      await doStatusAll(args);
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`Fatal error: ${err}`);
  process.exit(1);
});
