import * as fs from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';
import type { AccordConfig, DispatcherConfig, ServiceConfig } from './types.js';

const DISPATCHER_DEFAULTS: DispatcherConfig = {
  workers: 4,
  poll_interval: 30,
  session_max_requests: 15,
  session_max_age_hours: 24,
  request_timeout: 600,
  max_attempts: 3,
  model: 'claude-sonnet-4-5-20250929',
  debug: false,
  agent: 'claude-code',
};

export function loadConfig(targetDir: string): AccordConfig {
  // Try .accord/config.yaml (service repo / monorepo), then config.yaml (hub)
  const candidates = [
    path.join(targetDir, '.accord', 'config.yaml'),
    path.join(targetDir, 'config.yaml'),
  ];

  let configPath: string | null = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      configPath = c;
      break;
    }
  }

  if (!configPath) {
    throw new Error(`No config.yaml found in ${targetDir} (checked .accord/config.yaml and config.yaml)`);
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const config = YAML.parse(raw) as AccordConfig;

  // Normalize: project can be string or { name: string }
  if (typeof config.project === 'string') {
    (config as any).project = { name: config.project };
  }

  if (!config.project?.name) {
    throw new Error('config.yaml: project.name is required');
  }
  if (!config.services || config.services.length === 0) {
    throw new Error('config.yaml: services array is required and must be non-empty');
  }

  // Default repo_model
  if (!config.repo_model) {
    config.repo_model = config.role === 'orchestrator' ? 'multi-repo' : 'monorepo';
  }

  return config;
}

export function getDispatcherConfig(config: AccordConfig): DispatcherConfig {
  const userDispatcher = config.dispatcher ?? {};
  const debug = userDispatcher.debug ?? config.settings?.debug ?? DISPATCHER_DEFAULTS.debug;
  // agent_cmd fallback: dispatcher.agent_cmd > settings.agent_cmd
  const agent_cmd = userDispatcher.agent_cmd ?? config.settings?.agent_cmd;
  // Auto-detect agent type: if agent_cmd is set and agent not explicitly configured, use shell
  const agent = userDispatcher.agent ?? (agent_cmd ? 'shell' : DISPATCHER_DEFAULTS.agent);
  return { ...DISPATCHER_DEFAULTS, ...userDispatcher, debug, agent, ...(agent_cmd ? { agent_cmd } : {}) };
}

export function getServiceNames(config: AccordConfig): string[] {
  return config.services.map(s => s.name);
}

export function getServiceConfig(config: AccordConfig, serviceName: string): ServiceConfig | undefined {
  return config.services.find(s => s.name === serviceName);
}

/**
 * Get the working directory for a service.
 * - monorepo: same targetDir (all services share one repo)
 * - multi-repo: sibling directory or configured path
 */
export function getServiceDir(config: AccordConfig, serviceName: string, hubDir: string): string {
  if (config.repo_model === 'monorepo') {
    return hubDir;
  }

  // multi-repo: check for configured directory, else assume sibling
  const svc = getServiceConfig(config, serviceName);
  if (svc?.directory) {
    return path.resolve(hubDir, svc.directory);
  }
  return path.resolve(hubDir, '..', serviceName);
}

/**
 * Get the .accord directory for a given target.
 * Hub repos use root-level dirs (contracts/, comms/), service repos use .accord/
 */
export function getAccordDir(targetDir: string, config: AccordConfig): string {
  if (config.role === 'orchestrator') {
    return targetDir; // hub: flat structure
  }
  return path.join(targetDir, '.accord');
}

/**
 * Get inbox path for a service or module.
 */
export function getInboxPath(accordDir: string, name: string): string {
  return path.join(accordDir, 'comms', 'inbox', name);
}
