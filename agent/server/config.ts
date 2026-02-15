import * as fs from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';
import type { AccordConfig, DispatcherConfig, OrgConfig, ServiceConfig, RegistryYaml } from './types.js';

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
  planner_enabled: false,
  planner_model: 'claude-haiku-4-5-20251001',
  planner_timeout: 300,
};

export function loadConfig(targetDir: string): AccordConfig {
  // Try direct config locations first: .accord/config.yaml (service), config.yaml (flat hub)
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

  // If no direct config, try multi-team hub: accord.yaml → teams/{team}/config.yaml
  let teamDir: string | undefined;
  let teamName: string | undefined;

  if (!configPath) {
    const orgPath = path.join(targetDir, 'accord.yaml');
    if (fs.existsSync(orgPath)) {
      const orgRaw = fs.readFileSync(orgPath, 'utf-8');
      const orgConfig = YAML.parse(orgRaw) as OrgConfig;

      if (orgConfig.teams && orgConfig.teams.length > 0) {
        // Find the first team with a config.yaml
        for (const t of orgConfig.teams) {
          const candidate = path.join(targetDir, 'teams', t.name, 'config.yaml');
          if (fs.existsSync(candidate)) {
            configPath = candidate;
            teamDir = path.join(targetDir, 'teams', t.name);
            teamName = t.name;
            break;
          }
        }
      }
    }
  }

  if (!configPath) {
    throw new Error(`No config.yaml found in ${targetDir} (checked .accord/config.yaml, config.yaml, and accord.yaml → teams/*/config.yaml)`);
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

  // Store team info for multi-team hubs
  if (teamDir) {
    config.team = teamName;
    config.teamDir = teamDir;
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
  // Orchestrator always runs in the hub directory itself
  if (serviceName === 'orchestrator') {
    return hubDir;
  }

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
 * - Multi-team hub: teams/{team}/ directory
 * - Flat hub: root directory
 * - Service repo: .accord/
 */
export function getAccordDir(targetDir: string, config: AccordConfig): string {
  if (config.role === 'orchestrator') {
    // Multi-team hub: use team directory
    if (config.teamDir) {
      return config.teamDir;
    }
    return targetDir; // flat hub: root-level structure
  }
  return path.join(targetDir, '.accord');
}

/**
 * Get all accord directories to scan.
 * Returns an array of directories, each containing comms/inbox/ structure.
 */
export function getAllAccordDirs(targetDir: string, config: AccordConfig): string[] {
  return [getAccordDir(targetDir, config)];
}

/**
 * Get inbox path for a service or module.
 */
export function getInboxPath(accordDir: string, name: string): string {
  return path.join(accordDir, 'comms', 'inbox', name);
}

/**
 * Load a YAML registry entry for a service.
 * Tries v2 YAML first, falls back to v1 markdown (returns null if not found).
 */
export function loadRegistryYaml(teamDir: string, serviceName: string): RegistryYaml | null {
  const yamlPath = path.join(teamDir, 'registry', `${serviceName}.yaml`);
  if (fs.existsSync(yamlPath)) {
    return YAML.parse(fs.readFileSync(yamlPath, 'utf-8')) as RegistryYaml;
  }
  // v1 fallback: markdown registry (parse name + frontmatter-like fields)
  const mdPath = path.join(teamDir, 'registry', `${serviceName}.md`);
  if (fs.existsSync(mdPath)) {
    return parseMarkdownRegistry(mdPath);
  }
  return null;
}

function parseMarkdownRegistry(filePath: string): RegistryYaml | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    // Markdown registry has YAML-like frontmatter between --- markers
    const match = raw.match(/^---\n([\s\S]*?)\n---/m);
    if (!match) return null;
    const data = YAML.parse(match[1]);
    return {
      name: data.name ?? path.basename(filePath, '.md'),
      type: data.type,
      maintainer: data.maintainer ?? 'ai',
      language: data.language,
      directory: data.directory,
      contract: data.contract,
    } as RegistryYaml;
  } catch {
    return null;
  }
}
