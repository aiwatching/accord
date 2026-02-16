import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';
import { getHubState, setHubState } from '../hub-state.js';
import { getAccordDir, getServiceDir, loadConfig, loadRegistryYaml, saveConfig } from '../config.js';
import { scanInboxes, scanArchives } from '../scanner.js';
import { gitCommit, syncPush, cloneRepo, getRemoteUrl } from '../git-sync.js';
import { eventBus } from '../event-bus.js';
import { logger } from '../logger.js';
import type { ServiceConfig, MaintainerType } from '../types.js';

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const AUTO_SYNC_HOOK = `#!/usr/bin/env bash
# Accord Auto-Sync Hook for Claude Code
# Installed as a Claude Code hook (SessionStart / Stop).
# Syncs the hub clone at .accord/.hub/ so the agent sees latest state.

set -euo pipefail

PROJECT_DIR="\${CLAUDE_PROJECT_DIR:-.}"
cd "$PROJECT_DIR"

HOOK_INPUT=""
if ! tty -s 2>/dev/null; then
    HOOK_INPUT="$(cat)"
fi

# Only run if we have a hub clone
HUB_DIR=".accord/.hub"
[[ -d "$HUB_DIR" ]] || exit 0

# Find the hub clone subdirectory
HUB_CLONE=""
for d in "$HUB_DIR"/*/; do
    [[ -d "$d/.git" ]] && HUB_CLONE="$d" && break
done
[[ -z "$HUB_CLONE" ]] && exit 0

# Determine event type
EVENT=""
if [[ -n "$HOOK_INPUT" ]]; then
    EVENT="$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name',''))" 2>/dev/null || true)"
fi

# Time-gating for Stop events (5 min interval)
TIMESTAMP_FILE=".accord/.last-sync-pull"
INTERVAL=300
if [[ "$EVENT" == "Stop" ]]; then
    if [[ -f "$TIMESTAMP_FILE" ]]; then
        LAST_SYNC="$(cat "$TIMESTAMP_FILE")"
        NOW="$(date +%s)"
        ELAPSED=$((NOW - LAST_SYNC))
        if [[ "$ELAPSED" -lt "$INTERVAL" ]]; then
            exit 0
        fi
    fi
fi

# Pull latest from hub
(cd "$HUB_CLONE" && git pull --rebase --quiet) 2>/dev/null || true
date +%s > "$TIMESTAMP_FILE"
echo "[accord-auto-sync] Hub sync completed."
`;

/**
 * Initialize a service repo's .accord/ directory after cloning.
 * Creates: service.yaml, .hub/ (cloned from hub), .gitignore, hooks/accord-auto-sync.sh
 */
function initServiceRepo(
  svcDir: string,
  serviceName: string,
  hubDir: string,
  team: string | undefined,
): void {
  const accordDir = path.join(svcDir, '.accord');
  fs.mkdirSync(accordDir, { recursive: true });

  // 1. service.yaml — service identity
  const hubUrl = getRemoteUrl(hubDir);
  const serviceYaml: Record<string, unknown> = {
    version: '1.0',
    service: serviceName,
  };
  if (team) serviceYaml.team = team;
  if (hubUrl) serviceYaml.hub = hubUrl;
  fs.writeFileSync(
    path.join(accordDir, 'service.yaml'),
    YAML.stringify(serviceYaml),
    'utf-8',
  );

  // 2. .hub/ — clone the hub repo into it
  const hubCloneDir = path.join(accordDir, '.hub');
  fs.mkdirSync(hubCloneDir, { recursive: true });
  if (hubUrl) {
    try {
      const hubBasename = path.basename(hubUrl, '.git');
      cloneRepo(hubUrl, path.join(hubCloneDir, hubBasename));
    } catch (err) {
      logger.warn(`Failed to clone hub into service .accord/.hub/: ${err}`);
      // Non-fatal — service can still work without hub clone
    }
  }

  // 3. .gitignore — runtime files
  fs.writeFileSync(
    path.join(accordDir, '.gitignore'),
    '.hub/\n.last-sync-pull\n.agent.pid\n',
    'utf-8',
  );

  // 4. hooks/accord-auto-sync.sh
  const hooksDir = path.join(accordDir, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, 'accord-auto-sync.sh');
  fs.writeFileSync(hookPath, AUTO_SYNC_HOOK, { mode: 0o755 });

  // 5. Commit the .accord/ setup in the service repo
  gitCommit(svcDir, `accord: initialize .accord/ for ${serviceName}`);

  logger.info(`Initialized service repo .accord/ at ${accordDir}`);
}

interface AddServiceBody {
  name: string;
  type?: 'service' | 'module';
  directory?: string;
  language?: string;
  repo?: string;
  description?: string;
  maintainer?: MaintainerType;
}

export function registerServiceRoutes(app: FastifyInstance): void {
  // GET /api/services — list all services with status
  app.get('/api/services', async () => {
    const { config, hubDir, dispatcher } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const allRequests = scanInboxes(accordDir, config, hubDir);
    const workerStatuses = dispatcher.status.workers;

    return config.services.map(svc => {
      const registry = loadRegistryYaml(accordDir, svc.name);
      const pendingCount = allRequests.filter(
        r => r.serviceName === svc.name && (r.frontmatter.status === 'pending' || r.frontmatter.status === 'approved')
      ).length;
      const isWorking = workerStatuses.some(
        w => w.state === 'busy' && allRequests.some(
          r => r.serviceName === svc.name && r.frontmatter.id === w.currentRequest
        )
      );

      return {
        name: svc.name,
        type: svc.type ?? 'service',
        directory: svc.directory,
        language: svc.language,
        maintainer: registry?.maintainer ?? 'unknown',
        description: registry?.description ?? null,
        status: isWorking ? 'working' : pendingCount > 0 ? 'pending' : 'idle',
        pendingRequests: pendingCount,
      };
    });
  });

  // GET /api/services/:name — single service detail
  app.get<{ Params: { name: string } }>('/api/services/:name', async (req, reply) => {
    const { config, hubDir } = getHubState();
    const svc = config.services.find(s => s.name === req.params.name);
    if (!svc) return reply.status(404).send({ error: 'Service not found' });

    const accordDir = getAccordDir(hubDir, config);
    const registry = loadRegistryYaml(accordDir, svc.name);
    const allRequests = scanInboxes(accordDir, config, hubDir);
    const serviceRequests = allRequests.filter(r => r.serviceName === svc.name);

    // Check archive too (root + team level for multi-team hubs)
    const archived = scanArchives(accordDir, config, hubDir);

    return {
      name: svc.name,
      type: svc.type ?? 'service',
      directory: svc.directory ?? getServiceDir(config, svc.name, hubDir),
      language: svc.language,
      repo: svc.repo,
      registry: registry ?? null,
      requests: serviceRequests.map(r => ({
        id: r.frontmatter.id,
        status: r.frontmatter.status,
        priority: r.frontmatter.priority,
        type: r.frontmatter.type,
        from: r.frontmatter.from,
        created: r.frontmatter.created,
      })),
      archivedCount: archived.length,
    };
  });

  // GET /api/services/:name/registry — raw registry content
  app.get<{ Params: { name: string } }>('/api/services/:name/registry', async (req, reply) => {
    const { config, hubDir } = getHubState();
    const accordDir = getAccordDir(hubDir, config);
    const registry = loadRegistryYaml(accordDir, req.params.name);
    if (!registry) return reply.status(404).send({ error: 'Registry not found' });
    return registry;
  });

  // POST /api/services — register a new service
  app.post<{ Body: AddServiceBody }>('/api/services', async (req, reply) => {
    const { name, type, directory, language, repo, description, maintainer } = req.body ?? {};

    // Validate name
    if (!name) {
      return reply.status(400).send({ error: 'name is required' });
    }
    if (!NAME_RE.test(name)) {
      return reply.status(400).send({ error: 'name must match /^[a-z0-9][a-z0-9-]*$/' });
    }

    const state = getHubState();
    const { config, hubDir } = state;

    // Check for duplicates
    if (config.services.some(s => s.name === name)) {
      return reply.status(400).send({ error: `Service '${name}' already exists` });
    }

    // Build new service config entry
    const svcEntry: ServiceConfig = { name };
    const svcType = type ?? 'service';
    if (svcType !== 'service') svcEntry.type = svcType;
    if (directory) svcEntry.directory = directory;
    if (language) svcEntry.language = language;
    if (repo) svcEntry.repo = repo;

    // Add to config and persist
    config.services.push(svcEntry);
    saveConfig(hubDir, config);

    // Reload config from disk to update HubState
    const fresh = loadConfig(hubDir);
    setHubState({ ...state, config: fresh });

    // Create filesystem scaffolding
    const accordDir = getAccordDir(hubDir, fresh);

    // Inbox
    const inboxDir = path.join(accordDir, 'comms', 'inbox', name);
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(path.join(inboxDir, '.gitkeep'), '', 'utf-8');

    // Registry
    const registryDir = path.join(accordDir, 'registry');
    fs.mkdirSync(registryDir, { recursive: true });
    const registryContent: Record<string, unknown> = { name, maintainer: maintainer ?? 'ai' };
    if (description) registryContent.description = description;
    if (language) registryContent.language = language;
    if (svcType === 'module') {
      registryContent.contract = `contracts/internal/${name}.md`;
    } else {
      registryContent.contract = `contracts/${name}.yaml`;
    }
    fs.writeFileSync(
      path.join(registryDir, `${name}.yaml`),
      YAML.stringify(registryContent),
      'utf-8',
    );

    // Contract stub
    if (svcType === 'module') {
      const internalDir = path.join(accordDir, 'contracts', 'internal');
      fs.mkdirSync(internalDir, { recursive: true });
      const contractContent = [
        '---',
        `module: ${name}`,
        language ? `language: ${language}` : null,
        'status: draft',
        '---',
        `# ${name} Internal Contract`,
        '',
      ].filter(Boolean).join('\n');
      fs.writeFileSync(path.join(internalDir, `${name}.md`), contractContent, 'utf-8');
    } else {
      const contractDir = path.join(accordDir, 'contracts');
      fs.mkdirSync(contractDir, { recursive: true });
      const contractContent = YAML.stringify({
        openapi: '3.0.3',
        info: { title: `${name} API`, version: '0.1.0' },
        paths: {},
      });
      fs.writeFileSync(path.join(contractDir, `${name}.yaml`), contractContent, 'utf-8');
    }

    // Clone repo if provided (multi-repo)
    if (repo) {
      const svcDir = getServiceDir(fresh, name, hubDir);
      if (!fs.existsSync(svcDir)) {
        try {
          cloneRepo(repo, svcDir);
        } catch (err) {
          logger.error(`Failed to clone repo for ${name}: ${err}`);
          return reply.status(500).send({ error: `Failed to clone repo: ${err}` });
        }
      }
      // Initialize the service repo's .accord/ directory
      initServiceRepo(svcDir, name, hubDir, fresh.team);
    }

    // Git commit + push
    gitCommit(hubDir, `accord: add service '${name}'`);
    syncPush(hubDir, fresh);

    // Emit event
    eventBus.emit('service:added', { name, type: svcType, directory, repo });

    logger.info(`Service '${name}' registered (type: ${svcType})`);
    return reply.status(201).send({
      name,
      type: svcType,
      directory,
      language,
      repo,
      description,
      maintainer: maintainer ?? 'ai',
    });
  });

  // DELETE /api/services/:name — remove a service
  app.delete<{ Params: { name: string } }>('/api/services/:name', async (req, reply) => {
    const { name } = req.params;
    const state = getHubState();
    const { config, hubDir } = state;

    const idx = config.services.findIndex(s => s.name === name);
    if (idx === -1) {
      return reply.status(404).send({ error: `Service '${name}' not found` });
    }

    // Remove from config
    config.services.splice(idx, 1);
    saveConfig(hubDir, config);

    // Reload config from disk
    const fresh = loadConfig(hubDir);
    setHubState({ ...state, config: fresh });

    // Move inbox to archive (preserve history)
    const accordDir = getAccordDir(hubDir, fresh);
    const inboxDir = path.join(accordDir, 'comms', 'inbox', name);
    if (fs.existsSync(inboxDir)) {
      const archiveDir = path.join(accordDir, 'comms', 'archive');
      fs.mkdirSync(archiveDir, { recursive: true });
      const archiveDest = path.join(archiveDir, `${name}-${Date.now()}`);
      fs.renameSync(inboxDir, archiveDest);
    }

    // Git commit + push
    gitCommit(hubDir, `accord: remove service '${name}'`);
    syncPush(hubDir, fresh);

    // Emit event
    eventBus.emit('service:removed', { name });

    logger.info(`Service '${name}' removed`);
    return reply.status(200).send({ removed: name });
  });
}
