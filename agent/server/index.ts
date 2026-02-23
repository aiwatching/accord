#!/usr/bin/env node

import * as path from 'node:path';
import { loadConfig, getDispatcherConfig, getAccordDir } from './config.js';
import { startServer, stopServer } from './http.js';
import { Dispatcher } from './dispatcher.js';
import { OrchestratorCoordinator } from './orchestrator.js';
import { setHubState, triggerDispatch } from './hub-state.js';
import { recoverStaleRequests } from './scanner.js';
import { logger } from './logger.js';
import { startContractPipeline } from './a2a/contract-pipeline.js';

// ── CLI argument parsing ───────────────────────────────────────────────────

interface CLIArgs {
  hubDir: string;
  port?: number;
  timeout?: number;
  agentCmd?: string;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    hubDir: process.cwd(),
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
Usage: accord-hub [options]

Accord Hub Service — A2A-based agent coordination with REST API, WebSocket, and web UI.

Options:
  --hub-dir <path>          Hub/project directory (default: current directory)
  --port <number>           HTTP server port (default: 3000)
  --timeout <seconds>       Per-request timeout (default: 600)
  --agent-cmd <cmd>         Shell command to use as agent (instead of Claude SDK)
  --help                    Show this help message

The hub service provides:
  - REST API at /api/*
  - WebSocket streaming at /ws
  - Web UI at /
  - A2A agent card at /.well-known/agent-card.json
  - Contract validation pipeline for A2A artifacts
`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  process.title = 'accord-hub';

  const config = loadConfig(args.hubDir);
  const dispatcherConfig = getDispatcherConfig(config);

  // Port: CLI > config > default
  const port = args.port || config.dispatcher?.port || 3000;

  // Apply CLI overrides
  if (args.timeout) dispatcherConfig.request_timeout = args.timeout;
  if (args.agentCmd) {
    dispatcherConfig.agent = 'shell';
    dispatcherConfig.agent_cmd = args.agentCmd;
  }

  logger.init(args.hubDir, dispatcherConfig.debug);

  // Create dispatcher (A2A-only mode)
  const dispatcher = new Dispatcher(dispatcherConfig, config, args.hubDir);

  // Start coordinator if coordination loop is enabled
  let coordinator: OrchestratorCoordinator | undefined;
  if (dispatcherConfig.coordination_loop_enabled) {
    coordinator = new OrchestratorCoordinator({
      config,
      hubDir: args.hubDir,
      testAgentService: dispatcherConfig.test_agent_service,
      maxRetries: dispatcherConfig.max_directive_retries,
      negotiationTimeoutMs: (dispatcherConfig.negotiation_timeout ?? 600) * 1000,
    });
    coordinator.loadDirectives();
    coordinator.start();
    logger.info('Coordination loop enabled');
  }

  // Register shared state for route handlers
  setHubState({ hubDir: args.hubDir, config, dispatcherConfig, dispatcher, coordinator });

  // Start the Fastify server (API + WebSocket + UI)
  await startServer(port, args.hubDir);

  // Start contract update pipeline (A2A artifact → validate → git commit)
  const accordDir = getAccordDir(args.hubDir, config);
  startContractPipeline(accordDir, args.hubDir);

  // Recover stale in-progress requests from a previous crash
  const recovered = recoverStaleRequests(accordDir, config, args.hubDir);
  if (recovered > 0) {
    logger.info(`Recovered ${recovered} stale in-progress request(s) → pending`);
  }

  // Poll for pending requests every 5s and dispatch via A2A
  const dispatchInterval = setInterval(() => { triggerDispatch(); }, 5000);
  // Also run once on startup
  setTimeout(() => { triggerDispatch(); }, 1000);

  // Graceful shutdown
  const shutdown = async () => {
    clearInterval(dispatchInterval);
    logger.info('Shutting down...');
    if (coordinator) coordinator.stop();
    const adapter = dispatcher.getAdapter();
    if (adapter.closeAll) await adapter.closeAll();
    await stopServer();
    logger.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info(`Accord Hub Service started — port ${port}, A2A mode`);
}

main().catch(err => {
  console.error(`Fatal error: ${err}`);
  process.exit(1);
});
