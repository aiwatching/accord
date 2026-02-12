# Accord: Setup Guide

This guide walks through setting up a multi-service project with Accord. The hub is the central coordination point — all setup starts here.

## Prerequisites

- Git
- An AI agent that can read/write files (this guide uses Claude Code)

---

## 1. Install Accord

```bash
curl -fsSL https://raw.githubusercontent.com/aiwatching/accord/main/install.sh | bash
```

This clones Accord to `~/.accord/`. Pin a specific version with `ACCORD_VERSION=v0.2.0` before the curl command.

---

## 2. Create the Hub

The hub is a **separate, independent repository** — it does not live inside any service project. It holds all contracts, registries, communication inboxes, and orchestrator instructions.

### Step 1: Create a remote repo

Create an empty repository on GitHub/GitLab (e.g., `my-project-hub`).

### Step 2: Clone and initialize

```bash
git clone git@github.com:org/my-project-hub.git
cd my-project-hub

~/.accord/init.sh \
  --role orchestrator \
  --project-name "my-project" \
  --services "device-manager,web-server,frontend" \
  --adapter claude-code \
  --no-interactive
```

This creates a flat hub structure (no `.accord/` prefix):

```
my-project-hub/
├── config.yaml                      ← role: orchestrator
├── directives/                      ← high-level requirements
├── registry/                        ← service registries
├── contracts/                       ← service contracts (OpenAPI)
│   └── internal/
├── comms/
│   ├── inbox/
│   │   ├── orchestrator/            ← escalated requests arrive here
│   │   ├── device-manager/          ← requests dispatched to device-manager
│   │   ├── web-server/
│   │   └── frontend/
│   ├── archive/
│   ├── history/                     ← audit log (JSONL)
│   ├── PROTOCOL.md
│   └── TEMPLATE.md
├── protocol/
│   ├── history/write-history.sh
│   └── templates/directive.md.template
├── CLAUDE.md                        ← orchestrator agent instructions
└── .claude/commands/                ← orchestrator slash commands
```

### Step 3: Commit and push

```bash
git add .
git commit -m "accord: init orchestrator hub"
git push -u origin main
```

---

## 3. Initialize Service Repos

Each service lives in its own repository. Clone them as **siblings** of the hub directory:

```
~/projects/
├── my-project-hub/     ← hub (already initialized above)
├── device-manager/     ← service repo (cloned)
├── web-server/         ← service repo (cloned)
└── frontend/           ← service repo (cloned)
```

### One command — init hub + all services together

You can combine step 2 and step 3 into a single command by adding `--init-services`:

```bash
cd my-project-hub

~/.accord/init.sh \
  --role orchestrator \
  --project-name "my-project" \
  --services "device-manager,web-server,frontend" \
  --adapter claude-code \
  --hub git@github.com:org/my-project-hub.git \
  --init-services \
  --no-interactive
```

This initializes the hub AND all service repos in one pass. It looks for each service as a sibling directory (`../device-manager`, `../web-server`, `../frontend`).

### Or init services separately (e.g., adding a new service later)

```bash
~/.accord/init.sh \
  --target-dir ../new-service \
  --repo-model multi-repo \
  --hub git@github.com:org/my-project-hub.git \
  --services "device-manager,web-server,frontend,new-service" \
  --adapter claude-code \
  --no-interactive
```

### What happens per service

Each service init:
1. Creates `.accord/` structure with config, contracts, comms, and registry
2. Clones the hub into `.accord/hub/`
3. Pushes the service's own contract to the hub
4. Pulls other services' contracts from the hub
5. Installs the Claude Code adapter (CLAUDE.md, slash commands, scanner skill)

### What each service gets

```
device-manager/
├── .accord/
│   ├── config.yaml
│   ├── contracts/
│   │   ├── device-manager.yaml    ← own contract (editable)
│   │   ├── web-server.yaml        ← pulled from hub (read-only)
│   │   └── frontend.yaml          ← pulled from hub (read-only)
│   ├── registry/
│   │   └── device-manager.md      ← own registry
│   ├── comms/
│   │   ├── inbox/device-manager/  ← incoming requests
│   │   ├── archive/
│   │   ├── PROTOCOL.md
│   │   └── TEMPLATE.md
│   ├── hub/                       ← cloned hub (for sync)
│   └── accord-sync.sh
├── CLAUDE.md
└── .claude/
    ├── commands/accord-*.md
    └── skills/contract-scanner/
```

### Commit each service

```bash
cd ../device-manager && git add .accord CLAUDE.md .claude && git commit -m "accord: init service"
cd ../web-server && git add .accord CLAUDE.md .claude && git commit -m "accord: init service"
cd ../frontend && git add .accord CLAUDE.md .claude && git commit -m "accord: init service"
```

---

## 4. Start Working

Open **4 terminal windows**, one for each repo. Start Claude Code in each:

```
Window 1: my-project-hub/      → claude   (orchestrator)
Window 2: device-manager/      → claude   (service agent)
Window 3: web-server/          → claude   (service agent)
Window 4: frontend/            → claude   (service agent)
```

Each agent reads its Accord config on startup and is ready to accept commands.

### Orchestrator commands (hub window)

| Command | Description |
|---------|-------------|
| `/accord-decompose` | Decompose a pending directive into per-service requests |
| `/accord-route` | Route escalated requests to the correct service |
| `/accord-monitor` | Track directive progress across all services |
| `/accord-check-inbox` | Check orchestrator inbox and directive overview |

### Service commands (service windows)

| Command | Description |
|---------|-------------|
| `/accord-check-inbox` | Check for incoming requests |
| `/accord-send-request` | Send a request to another service |
| `/accord-complete-request` | Mark a request as completed and archive it |
| `/accord-dispatch` | Decompose a multi-module feature into per-module tasks |
| `/accord-scan` | Auto-scan source code to generate/update contracts |
| `/accord-validate` | Validate all contracts and requests |
| `/accord-status` | Show Accord status (config, contracts, inbox) |
| `/accord-sync` | Manual hub sync (pull/push) |

---

## 5. Typical Workflow

### Create a directive (hub)

A directive is a high-level requirement that spans multiple services.

```bash
# In the hub, copy from template:
cp protocol/templates/directive.md.template directives/dir-001-add-search.md
```

Edit the directive file:

```yaml
---
id: dir-001-add-search
title: Add device search across all services
priority: high
status: pending
created: 2026-02-11T10:00:00Z
updated: 2026-02-11T10:00:00Z
requests: []
---

## Requirement

Users need to search devices by name, type, and status across the dashboard.
This requires a search API in device-manager, a proxy in web-server, and
a search UI in frontend.

## Acceptance Criteria

- Device-manager exposes GET /api/devices/search with query params
- Web-server proxies the search endpoint
- Frontend has a working search bar on the devices page
```

Commit and push, then use `/accord-decompose` in the hub window. The orchestrator will:
1. Read registries to determine which services own what
2. Create per-service requests in `comms/inbox/{service}/`
3. Update the directive to `in-progress`
4. Write history entries and push

### Pick up requests (services)

Each service agent uses `/accord-check-inbox` (or auto-syncs on session start) to find new requests. The standard lifecycle applies:

```
pending → approved → in-progress → completed
```

### Monitor progress (hub)

Use `/accord-monitor` in the hub window to check which requests are completed. When all requests for a directive are done, the directive moves to `completed`.

---

## 6. Sync

Services sync with the hub to exchange contracts, requests, registries, and history.

```bash
# Pull latest from hub:
bash .accord/accord-sync.sh pull --target-dir .

# Push local changes to hub:
bash .accord/accord-sync.sh push --target-dir .
```

With `--sync-mode on-action` (default), the Claude Code adapter auto-syncs at session start.

---

## 7. History & Audit Trail

All state transitions are tracked as JSONL entries in `comms/history/`.

```
comms/history/{YYYY-MM-DD}-{actor}.jsonl
```

Each actor writes to its own daily file, avoiding Git merge conflicts.

```json
{"ts":"2026-02-11T10:30:00Z","request_id":"req-001","from_status":"pending","to_status":"approved","actor":"device-manager","detail":"Approved by human review"}
```

---

## 8. Validation & Diagnostics

```bash
# Validate contracts, requests, directives
bash ~/.accord/protocol/scan/validators/validate-openapi.sh .accord/contracts/backend.yaml
bash ~/.accord/protocol/scan/validators/validate-request.sh .accord/comms/inbox/backend/req-001.md
bash ~/.accord/protocol/scan/validators/validate-directive.sh directives/dir-001.md

# Health check
~/.accord/accord-doctor.sh --project-dir .

# Run all tests
bash ~/.accord/test.sh
```

---

## 9. Upgrade & Uninstall

```bash
# Upgrade Accord
~/.accord/upgrade.sh

# Uninstall from a project
~/.accord/uninstall.sh --project-dir .

# Remove Accord entirely
rm -rf ~/.accord
```

---

## Quick Reference

### State Machine (Requests)

```
pending → approved → in-progress → completed
pending → rejected
```

### State Machine (Directives)

```
pending → in-progress → completed
pending → in-progress → failed → pending (re-decompose)
```

### init.sh Options

```
--project-name <name>    Project name
--services <csv>         Service names (comma-separated)
--service <name>         Service with sub-modules
--modules <csv>          Explicit module names
--adapter <name>         claude-code | cursor | codex | generic | none
--repo-model <model>     monorepo | multi-repo (default: monorepo)
--hub <git-url>          Hub repo URL (multi-repo only)
--language <lang>        java | python | typescript | go (default: java)
--sync-mode <mode>       on-action | auto-poll | manual (default: on-action)
--role <role>            orchestrator | service (default: service)
--target-dir <path>      Target directory (default: current directory)
--scan                   Auto-scan source code for contracts after init
--force                  Re-initialize (preserves existing contracts)
--no-interactive         Use auto-detected defaults, no prompts
```
