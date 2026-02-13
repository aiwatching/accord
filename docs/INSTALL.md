# Accord: Setup Guide

## Step 1. Install

```bash
curl -fsSL https://raw.githubusercontent.com/aiwatching/accord/main/install.sh | bash
```

## Step 2. Set Up Project

Create a project directory and run the setup wizard:

```bash
mkdir my-project && cd my-project
~/.accord/setup.sh
```

The wizard guides you step by step:

```
=== Accord Project Setup ===

  Project name [my-project]:
  Hub git URL: git@github.com:org/my-project-hub.git

  Services — enter names (comma-separated) or one per line:
  Service names: device-manager, web-server, frontend

  device-manager directory [./device-manager]:
  web-server directory [./web-server]:
  frontend directory [./frontend]:

  Adapter [claude-code]:
  Auto-scan source code for contracts? (y/N):

  ── Summary ──
  Project:   my-project
  Hub:       git@github.com:org/my-project-hub.git
  Services:
    device-manager → ./device-manager
    web-server → ./web-server
    frontend → ./frontend

  Proceed? (Y/n):
```

On confirm, setup.sh automatically:
1. Clones the hub (if not already present)
2. Initializes the hub as orchestrator
3. Initializes each service with hub sync

## Step 3. Commit

```bash
cd my-project-hub
git add . && git commit -m "accord: init hub" && git push

cd ../device-manager
git add .accord CLAUDE.md .claude && git commit -m "accord: init" && git push

# Repeat for each service
```

## Step 4. Build the Hub Service (optional — enables autonomous mode)

Each hub project is self-contained with its own server code and UI. The Hub Service provides a dispatcher + worker pool for fully autonomous request processing, powered by the Claude Agent SDK.

**Prerequisites:** Node.js >= 20

```bash
cd my-project-hub
npm install
npm run build
```

Verify:

```bash
cd my-project-hub && npm start -- --help
```

---

## Step 5. Start Agents

### Option A: Interactive (one terminal per repo)

```
Terminal 1:  cd my-project-hub   && claude    (orchestrator)
Terminal 2:  cd device-manager   && claude    (service)
Terminal 3:  cd web-server       && claude    (service)
Terminal 4:  cd frontend         && claude    (service)
```

### Option B: Hub Service (API + Web UI + scheduler)

```bash
# Start the Hub Service — API server, web dashboard, automatic scheduler
cd my-project-hub
npm start -- --port 3000 --workers 4 --interval 30

# Opens http://localhost:3000 with:
#   - Dashboard with live metrics
#   - Service/request/worker status
#   - WebSocket streaming of agent output
#   - REST API at /api/*
```

---

## Workflow

**Orchestrator (hub):**

| Command | What it does |
|---------|-------------|
| `/accord-decompose` | Break directive into per-service requests |
| `/accord-route` | Route escalated requests to correct service |
| `/accord-monitor` | Track progress across all services |
| `/accord-check-inbox` | Check orchestrator inbox |

**Service:**

| Command | What it does |
|---------|-------------|
| `/accord-check-inbox` | Check for incoming requests |
| `/accord-send-request` | Send a request to another service |
| `/accord-complete-request` | Complete and archive a request |
| `/accord-scan` | Auto-scan code for contracts |
| `/accord-status` | Show Accord status |

---

## Adding a Service Later

```bash
~/.accord/init.sh \
  --target-dir ./new-service \
  --repo-model multi-repo \
  --hub git@github.com:org/my-project-hub.git \
  --services "device-manager,web-server,frontend,new-service" \
  --adapter claude-code \
  --no-interactive
```

## Testing the Agent

### Unit & integration tests (framework development only)

```bash
cd <accord-framework>/agent
npm test                    # run all 80 tests
npm run test:watch          # re-run on file changes
```

Test coverage:
- `config.test.ts` — config loading, validation, dispatcher defaults merging
- `request.test.ts` — parsing, status updates, priority sorting, inbox scanning, archiving
- `session.test.ts` — session creation, rotation, disk persistence, crash-recovery checkpoints
- `prompt.test.ts` — prompt building with registry/contracts/checkpoint context
- `commands.test.ts` — command validation, status/check-inbox fast-path output
- `history.test.ts` — JSONL audit log writing, append to same file
- `dispatcher.test.ts` — worker init, dry-run scanning, command fast-path processing
- `integration.test.ts` — full end-to-end lifecycle: place request → dispatch → process → archive → history

### Manual verification

```bash
# Start Hub Service and check the dashboard
cd my-project-hub && npm start -- --port 3000

# Or trigger a manual sync via the API
curl -X POST http://localhost:3000/api/hub/sync

# Check logs
cat teams/<team>/log/agent-$(date +%Y-%m-%d).log
```

### Debugging

Enable debug logging in `.accord/config.yaml`:

```yaml
dispatcher:
  debug: true
```

Or `settings.debug: true` for all components. Logs go to `.accord/log/agent-YYYY-MM-DD.log`.

Key things to check:
- `--dry-run` output shows correct request discovery and priority ordering
- `status` / `status-all` shows daemon PID and state
- Log file shows tick cycle: pull → scan → assign → process → commit → push
- Archive directory gets completed requests with `## Result` sections
- History directory gets JSONL audit entries

## Upgrade & Uninstall

```bash
~/.accord/upgrade.sh                        # upgrade Accord
~/.accord/uninstall.sh --project-dir .       # remove from project
```
