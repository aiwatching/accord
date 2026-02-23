#!/usr/bin/env node
// Accord A2A — Standalone service agent CLI entry point
//
// Usage:
//   tsx server/a2a/serve.ts --name demo-engine --port 9001 --hub-dir /path/to/hub
//   npm run dev:service -- --name demo-engine --port 9001 --hub-dir /path/to/hub

import { createA2AService } from './service.js';
import { loadConfig, getDispatcherConfig, loadRegistryYaml, getAccordDir } from '../config.js';
import { createAdapter } from '../adapters/adapter.js';
import { logger } from '../logger.js';

// ── Parse CLI arguments ──────────────────────────────────────────────────────

function parseArgs(): { name: string; port: number; hubDir: string } {
  const args = process.argv.slice(2);
  let name: string | undefined;
  let port = 9001;
  let hubDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--name':
        name = args[++i];
        break;
      case '--port':
        port = parseInt(args[++i], 10);
        break;
      case '--hub-dir':
        hubDir = args[++i];
        break;
    }
  }

  if (!name) {
    console.error('Usage: serve.ts --name <service-name> --port <port> --hub-dir <path>');
    process.exit(1);
  }
  if (!hubDir) {
    console.error('Usage: serve.ts --name <service-name> --port <port> --hub-dir <path>');
    process.exit(1);
  }

  return { name, port, hubDir };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  // Load config from hub directory
  const config = loadConfig(args.hubDir);
  const dispatcherConfig = getDispatcherConfig(config);
  const accordDir = getAccordDir(args.hubDir, config);

  // Find the service in config
  const serviceConfig = config.services.find(s => s.name === args.name);
  if (!serviceConfig) {
    console.error(`Service "${args.name}" not found in config. Available: ${config.services.map(s => s.name).join(', ')}`);
    process.exit(1);
  }

  // Load registry if available
  const registry = loadRegistryYaml(accordDir, args.name);

  // Initialize logger
  logger.init(args.hubDir, dispatcherConfig.debug);

  // Create adapter
  const adapter = createAdapter({
    agent: dispatcherConfig.agent,
    agent_cmd: dispatcherConfig.agent_cmd,
    model: dispatcherConfig.model,
  });

  // Create and start the A2A service
  const service = createA2AService({
    agentCard: {
      service: serviceConfig,
      registry,
      port: args.port,
    },
    executor: {
      serviceName: args.name,
      adapter,
      accordConfig: config,
      dispatcherConfig,
      hubDir: args.hubDir,
    },
  });

  await service.start();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down A2A service...');
    await service.stop();
    const closeAdapter = adapter as { closeAll?: () => Promise<void> };
    if (closeAdapter.closeAll) await closeAdapter.closeAll();
    logger.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start A2A service:', err);
  process.exit(1);
});
