#!/usr/bin/env node

import * as path from 'node:path';
import { loadConfig, getDispatcherConfig } from './config.js';
import { startServer, stopServer } from './server.js';
import { Scheduler } from './scheduler.js';
import { Dispatcher } from './dispatcher.js';
import { setHubState } from './hub-state.js';
import { logger } from './logger.js';

// ── CLI argument parsing ───────────────────────────────────────────────────

interface CLIArgs {
  hubDir: string;
  port: number;
  workers?: number;
  interval?: number;
  timeout?: number;
  agentCmd?: string;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    hubDir: process.cwd(),
    port: 3000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--hub-dir':
        args.hubDir = path.resolve(argv[++i] ?? '.');
        break;
      case '--port':
        args.port = parseInt(argv[++i] ?? '3000', 10);
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
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
    }
  }

  return args;
}

function printUsage(): void {
  console.log(`
Usage: accord-agent [options]

Accord Hub Service — unified API server, web UI, scheduler, and worker pool.

Options:
  --hub-dir <path>          Hub/project directory (default: current directory)
  --port <number>           HTTP server port (default: 3000)
  --workers <N>             Number of concurrent workers (default: 4)
  --interval <seconds>      Scheduler polling interval (default: 30)
  --timeout <seconds>       Per-request timeout (default: 600)
  --agent-cmd <cmd>         Shell command to use as agent (instead of Claude SDK)
  --help                    Show this help message

The hub service provides:
  - REST API at /api/*
  - WebSocket streaming at /ws
  - Web UI at /
  - Automatic request scheduling and dispatch
`);
}

// ── Main ───────────────────────────────────────────────────────────────────

let scheduler: Scheduler | null = null;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  process.title = 'accord-hub';

  const config = loadConfig(args.hubDir);
  const dispatcherConfig = getDispatcherConfig(config);

  // Apply CLI overrides
  if (args.workers) dispatcherConfig.workers = args.workers;
  if (args.interval) dispatcherConfig.poll_interval = args.interval;
  if (args.timeout) dispatcherConfig.request_timeout = args.timeout;
  if (args.agentCmd) {
    dispatcherConfig.agent = 'shell';
    dispatcherConfig.agent_cmd = args.agentCmd;
  }

  logger.init(args.hubDir, dispatcherConfig.debug);

  // Create dispatcher and scheduler
  const dispatcher = new Dispatcher(dispatcherConfig, config, args.hubDir);
  scheduler = new Scheduler(dispatcher, config, args.hubDir, dispatcherConfig.poll_interval);

  // Register shared state for route handlers
  setHubState({ hubDir: args.hubDir, config, dispatcherConfig, dispatcher, scheduler });

  // Start the Fastify server (API + WebSocket + UI)
  await startServer(args.port, args.hubDir);

  // Start scheduling
  scheduler.start();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    if (scheduler) scheduler.stop();
    await stopServer();
    logger.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info(`Accord Hub Service started — port ${args.port}, ${dispatcherConfig.workers} workers, poll every ${dispatcherConfig.poll_interval}s`);
}

main().catch(err => {
  console.error(`Fatal error: ${err}`);
  process.exit(1);
});
