# Accord Command Reference

## CLI Tools

Scripts run directly in the terminal, **before** starting an agent session.

---

### `setup.sh`

Interactive wizard — bootstraps an entire project (hub + all services) in one pass.

```bash
~/.accord/setup.sh
```

Two modes:
- **Create new project**: asks for project name → hub URL → service names + directories + repo URLs → adapter → runs `init.sh` for hub and each service
- **Join existing project**: clones hub → reads `config.yaml` → clones service repos by `repo:` URL → inits each service (skips already-initialized ones)

Does NOT auto-discover subdirectories. Services must be explicitly listed.

---

### `init.sh`

Per-repo initialization. Non-interactive when flags are provided.

```bash
# Service repo
bash ~/.accord/init.sh \
  --project-name my-project \
  --services "frontend,backend" \
  --adapter claude-code \
  --target-dir ./frontend

# Orchestrator hub
bash ~/.accord/init.sh \
  --role orchestrator \
  --project-name my-project \
  --services "frontend,backend" \
  --adapter claude-code \
  --target-dir ./hub

# Hub + batch-init all service repos (sibling directories)
bash ~/.accord/init.sh \
  --role orchestrator \
  --init-services \
  --project-name my-project \
  --services "frontend,backend" \
  --hub ./hub \
  --adapter claude-code \
  --target-dir ./hub
```

Key flags:
| Flag | Description |
|------|-------------|
| `--role orchestrator` | Init as hub (flat structure, no `.accord/` prefix) |
| `--init-services` | After hub init, batch-init `--services` 中声明的同级目录（目录必须已存在，不会自动发现） |
| `--repo-model multi-repo` | Multi-repo mode (enables hub sync) |
| `--hub <url>` | Hub git URL for multi-repo |
| `--service-repos "a=url,b=url"` | Write `repo:` URLs into hub config |
| `--repo <url>` | Write `repo:` into service's own config |
| `--force` | Re-init (preserves existing contracts) |
| `--scan` | Auto-scan source code for contracts |
| `--sync-mode <mode>` | `on-action` / `auto-poll` / `manual` |

Idempotent — re-running without `--force` exits with "Already initialized".

---

### Hub Service (`server/`)

Unified Hub Service — API server, web UI, scheduler, dispatcher, and worker pool. Each hub project is self-contained with its own `server/` and `ui/` directories, copied from the framework during `setup.sh` / `init.sh`.

**Prerequisites:** Node.js >= 20, built project (`npm install && npm run build`)

#### Usage

```bash
# Start the Hub Service — API + Web UI + automatic scheduling
cd my-project-hub && npm start -- --port 3000 --workers 4 --interval 30

# Or in development mode (auto-reload)
cd my-project-hub && npm run dev
```

#### Web UI

Open `http://localhost:3000` for:
- **Dashboard**: overview cards, live event feed, agent output stream
- **Services**: grid of services with status, registry info
- **Requests**: filterable table of all requests (inbox + archive)
- **Workers**: worker pool status with live streaming output

#### REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/services` | GET | List all services with status |
| `/api/services/:name` | GET | Service detail + recent requests |
| `/api/services/:name/registry` | GET | Registry YAML content |
| `/api/requests` | GET | List requests (filter: `?service=&status=`) |
| `/api/requests/:id` | GET | Request detail (frontmatter + body) |
| `/api/requests` | POST | Create new request |
| `/api/requests/:id/retry` | POST | Reset failed request to pending |
| `/api/directives` | GET | List directives |
| `/api/directives` | POST | Create new directive |
| `/api/workers` | GET | Worker pool status |
| `/api/hub/status` | GET | Hub status, metrics, scheduler info |
| `/api/hub/sync` | POST | Trigger manual sync (pull + push) |

#### WebSocket

Connect to `/ws` for real-time events:
- `request:claimed`, `request:completed`, `request:failed`
- `worker:started`, `worker:output`, `worker:finished`
- `sync:pull`, `sync:push`, `scheduler:tick`

#### CLI Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--hub-dir <path>` | Hub/project directory | project root (auto-detected) |
| `--port <number>` | HTTP server port | `3000` |
| `--workers <N>` | Number of concurrent workers | `4` |
| `--interval <seconds>` | Scheduler polling interval | `30` |
| `--timeout <seconds>` | Per-request agent timeout | `600` |
| `--agent-cmd <cmd>` | Shell command for agent (instead of Claude SDK) | — |

#### Configuration via `config.yaml`

Add a `dispatcher:` section to `.accord/config.yaml` to configure defaults:

```yaml
dispatcher:
  workers: 4                   # concurrent workers
  poll_interval: 30            # seconds between ticks
  session_max_requests: 15     # rotate Claude session after N requests
  session_max_age_hours: 24    # rotate Claude session after N hours
  request_timeout: 600         # per-request timeout (seconds)
  max_attempts: 3              # max retries before marking failed
  model: claude-sonnet-4-5-20250929   # Claude model for agent invocations
  max_budget_usd: 5.0          # cost cap per agent invocation
  agent: claude-code           # agent adapter: "claude-code" or "shell"
  agent_cmd: "claude -p"       # shell command (only for agent: shell)
  debug: false                 # enable debug logging
```

CLI flags override config values. Config values override built-in defaults.

#### Agent Adapters

The dispatcher uses a pluggable agent adapter to invoke AI agents. Two adapters are available:

| Adapter | `agent:` value | Session Resume | Description |
|---------|---------------|----------------|-------------|
| Claude Code | `claude-code` (default) | Yes | Native Claude Agent SDK integration. Supports session resume across requests. |
| Shell | `shell` | No | Wraps any CLI agent via `agent_cmd`. Each invocation is independent. |

**Shell adapter** — use `agent: shell` with `agent_cmd` to integrate any agent that accepts a prompt argument:

```yaml
dispatcher:
  agent: shell
  agent_cmd: "claude --dangerously-skip-permissions -p"   # Claude Code CLI
  # agent_cmd: "codex -q"                                 # OpenAI Codex
  # agent_cmd: "/path/to/custom-agent.sh"                 # custom script
```

The shell adapter invokes `<agent_cmd> <prompt>` in the service directory. The agent is expected to read the prompt, perform the work, and exit. `agent_cmd` can also be set in `settings.agent_cmd` as a fallback.

#### Architecture

**Dispatcher → Worker Pool → Agent Adapter**

The dispatcher runs a tick loop: sync pull → scan all inboxes → assign pending requests to idle workers → workers process in parallel → commit → sync push.

**Worker assignment (session affinity):**
1. Best: idle worker with existing Claude session for this service
2. Good: idle worker with fewest sessions (load balance)

**Constraint**: Never assign two requests for the same service to different workers simultaneously (prevents git conflicts in the same repo).

#### Request Processing

**Command requests** (`type: command`) — shell fast-path (no AI agent): set `in-progress` → execute (`status`/`scan`/`check-inbox`/`validate`) → append `## Result` → set `completed` → archive → write history.

**All other requests** — Claude Agent SDK path:
1. **Claim**: set `in-progress`, increment `attempts`, commit + push (prevents duplicate processing)
2. **Invoke**: call Claude Agent SDK `query()` with built prompt (includes request, registry, contracts, skills, checkpoint context). Uses `resume` for session continuation.
3. **Success**: set `completed`, archive, write history, clear checkpoint
4. **Failure**: increment attempts → if < max_attempts: revert to `pending` for retry → if >= max_attempts: set `failed`, escalate to orchestrator

**Session management**: Claude sessions are reused across requests for the same service (via SDK `resume`). Sessions rotate after reaching `session_max_requests` or `session_max_age_hours`. Session IDs persist to disk (`.accord/.agent-sessions.json`) for resume across daemon restarts.

**Crash recovery**: Before invoking the agent, a checkpoint file is written (`.accord/comms/sessions/req-{id}.session.md`). If the daemon crashes and restarts, the checkpoint context is injected into the next invocation prompt.

**Error escalation**: On the final failed attempt, creates a `type: other` escalation request in the orchestrator inbox with failure reason, original request ID (`originated_from`), and service name.

**Push retry**: `git push` retries up to 3 times with `pull --rebase` on conflict.

#### Debugging

```bash
# Enable debug logging in config
# dispatcher.debug: true in .accord/config.yaml

# Log files written to:
.accord/log/agent-YYYY-MM-DD.log

# Check status via API
curl http://localhost:3000/api/hub/status
curl http://localhost:3000/api/workers

# Trigger manual sync
curl -X POST http://localhost:3000/api/hub/sync
```

#### Testing

```bash
cd agent
npm test                    # 67 unit + integration tests
npm run test:watch          # re-run on file changes

# Manual: dry-run against any project
accord-agent.sh run-once --dry-run --target-dir ./my-service

# Manual: process command requests only (safe, no AI agent invoked)
# Place a type: command request in an inbox, then:
accord-agent.sh run-once --target-dir ./my-service
```

---

## Service Commands

Commands available to service agents (installed via Claude Code adapter).

---

### `/accord-init`

One-click project setup: scaffold `.accord/`, scan source code for contracts, install adapter.

```
/accord-init
```

Prompts for: project name, services, repo model, language. Scans source code to generate real contracts (replacing templates). Runs validators. Does NOT auto-commit.

---

### `/accord-scan`

Scan source code and regenerate contract files.

```
/accord-scan                                  # scan current service
/accord-scan --service device-manager         # scan specific service
/accord-scan --type external                  # external contracts only
/accord-scan --type internal                  # internal contracts only
```

Output: `.accord/contracts/{service}.yaml` (OpenAPI) and `.accord/contracts/internal/{module}.md`. All generated as `draft`.

---

### `/accord-status`

Display project state overview: config, contracts, requests, recent git activity, health checks.

```
/accord-status
```

Example output:

```
External Contracts:
  demo-engine.yaml   stable   4 endpoints   0 proposed
  demo-admin.yaml    stable   3 endpoints   1 proposed (req-002)

Active Requests:
  req-002   frontend → demo-admin   pending   high   1d ago

Health:
  OK    Config valid
  WARN  req-002 pending for 3 days
```

---

### `/accord-validate`

Run all validators on contracts and requests. Checks format compliance + cross-references.

```
/accord-validate
```

Validates: OpenAPI contracts, internal contracts, request files. Also checks that `related_contract` references exist and `x-accord-request` annotations match live requests.

---

### `/accord-dispatch`

Break a feature into per-module tasks and spawn subagents to implement each part.

```
/accord-dispatch
```

Workflow: analyze module boundaries → build dispatch plan → user confirms → spawn subagents (parallel if independent, sequential if dependent) → verify contracts → sync.

For cross-service work (different repo), falls back to `/accord-send-request` instead.

---

### `/accord-check-inbox`

Check for incoming requests. Auto-processes `type: command` requests.

```
/accord-check-inbox
```

- Multi-repo: pulls from hub first
- Reads all `.accord/comms/inbox/{your-module}/` files
- Command requests (`type: command`): auto-executes, writes result, archives, pushes
- Regular requests: reports grouped by status (pending/approved/in-progress)

---

### `/accord-send-request`

Create and send a request to another service or module.

```
/accord-send-request
```

Prompts for: target, description, proposed change, priority. Creates request file in `comms/inbox/{target}/`, writes history entry, commits. Multi-repo: pushes to hub.

Example created file: `.accord/comms/inbox/backend/req-003-add-users-api.md`

---

### `/accord-complete-request`

Mark a request as completed and archive it.

```
/accord-complete-request
```

Pre-checks: contract updated, implementation matches, `x-accord-status: proposed` annotations removed. Updates status → `completed`, moves to `comms/archive/`, writes history, commits.

---

### `/accord-sync`

Sync with hub (multi-repo only).

```
/accord-sync
```

Prompts for pull or push:
- **Pull**: receives contracts, requests, registries from hub
- **Push**: sends own contract, outgoing requests, archived requests to hub

---

### `/accord-log`

Check debug logging status and show session summaries.

```
/accord-log
```

Shows: debug enabled/disabled, log file list with entry counts, latest session breakdown by category (lifecycle/comms/contract/git/scan), state transitions.

---

## Orchestrator Commands

Commands available to the orchestrator agent on the hub repo.

---

### `/accord-decompose`

Decompose a pending directive into per-service requests.

```
/accord-decompose
```

Workflow: list pending directives → analyze against registries and contracts → plan decomposition → user confirms → create request files in each `comms/inbox/{service}/` → update directive to `in-progress` → write history → commit & push.

Example:

```
Directive: dir-001 — Add device reboot
Decomposition:
  1. device-manager: Add POST /api/devices/{id}/reboot  → req-010
  2. frontend: Add reboot button in device detail page   → req-011 (depends on #1)
```

---

### `/accord-route`

Route escalated requests from `comms/inbox/orchestrator/` to the correct service.

```
/accord-route
```

Reads escalated request → consults registries to find correct owner → creates new request in target inbox (with `routed_by: orchestrator`) → archives original → writes history → pushes.

---

### `/accord-monitor`

Track directive progress and update statuses.

```
/accord-monitor
```

For each in-progress directive: checks all linked request statuses. If all completed → directive `completed`. If any rejected → directive `failed`. Outputs progress table:

```
dir-001  Add OAuth     in-progress  2/3 (67%)
dir-002  Fix login     completed    1/1 (100%)
```

---

### `/accord-check-inbox` (orchestrator)

Check orchestrator inbox and directive overview.

```
/accord-check-inbox
```

Shows: escalated requests in `comms/inbox/orchestrator/`, directive status counts, recommended next actions (decompose/route/monitor).

---

### `/accord-remote`

Send diagnostic commands to services (batch or targeted).

```
/accord-remote status                          # → ALL services
/accord-remote scan                            # → ALL services
/accord-remote validate --services frontend    # → one service
/accord-remote check-inbox --services a,b      # → subset
```

Creates `type: command` request files in each target's inbox. Single commit + push. Services auto-execute on next `/accord-check-inbox`.

Supported commands: `status`, `scan`, `check-inbox`, `validate`.

---

### `/accord-check-results`

Check results of previously sent remote commands.

```
/accord-check-results                          # show all
/accord-check-results --services frontend      # filter by service
```

Pulls latest, scans for `req-*-cmd-*` files in inbox (pending) and archive (completed). Shows result table with full output for completed commands.
