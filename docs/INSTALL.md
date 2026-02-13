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

## Step 4. Build the Agent (optional — enables autonomous mode)

The TypeScript agent provides a dispatcher + worker pool for fully autonomous request processing, powered by the Claude Agent SDK.

**Prerequisites:** Node.js >= 20

```bash
cd ~/.accord/agent
npm install
npm run build
```

Verify:

```bash
accord-agent.sh --help
accord-agent.sh run-once --dry-run --target-dir ./my-service
```

If Node.js is unavailable, `accord-agent.sh` falls back to the legacy bash agent automatically.

---

## Step 5. Start Agents

### Option A: Interactive (one terminal per repo)

```
Terminal 1:  cd my-project-hub   && claude    (orchestrator)
Terminal 2:  cd device-manager   && claude    (service)
Terminal 3:  cd web-server       && claude    (service)
Terminal 4:  cd frontend         && claude    (service)
```

### Option B: Autonomous daemon (headless)

```bash
# Start one agent process — monitors all service inboxes
accord-agent.sh start --target-dir ./my-project-hub --workers 4 --interval 30

# Check status
accord-agent.sh status --target-dir ./my-project-hub

# Stop
accord-agent.sh stop --target-dir ./my-project-hub
```

### Option C: One-shot processing

```bash
# Process all pending requests once, then exit
accord-agent.sh run-once --target-dir ./device-manager

# Dry-run: see what would be processed without executing
accord-agent.sh run-once --dry-run --target-dir ./device-manager
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

### Unit & integration tests

```bash
cd ~/.accord/agent
npm test                    # run all 67 tests
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
# Dry-run: show what would be processed (safe, no side-effects)
accord-agent.sh run-once --dry-run --target-dir ./my-service

# Process one tick against the example project
accord-agent.sh run-once --target-dir ./examples/microservice-project

# Check logs
cat ./my-service/.accord/log/agent-$(date +%Y-%m-%d).log
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
