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

### `accord-agent.sh`

Autonomous request processing daemon. Handles all request types in service inboxes:

- **`type: command`** → shell fast-path (no AI agent needed, same as before)
- **All other types** → invokes an AI agent (Claude Code by default) for autonomous implementation

```bash
# Process all requests once and exit
accord-agent.sh run-once --target-dir ./frontend

# Use a specific AI agent command
accord-agent.sh run-once --target-dir ./frontend --agent-cmd "claude --dangerously-skip-permissions -p"

# Start background daemon (polls every 60s)
accord-agent.sh start --target-dir ./frontend --interval 60

# Start with custom agent and timeout
accord-agent.sh start --target-dir ./frontend --agent-cmd "cursor-agent -p" --timeout 300

# Check daemon status
accord-agent.sh status --target-dir ./frontend

# Stop daemon
accord-agent.sh stop --target-dir ./frontend

# Start/stop daemons for ALL services (from hub directory)
accord-agent.sh start-all --target-dir ./hub
accord-agent.sh stop-all --target-dir ./hub
```

Flags:
| Flag | Description | Default |
|------|-------------|---------|
| `--target-dir <path>` | Project directory | `.` |
| `--interval <seconds>` | Polling interval for `start` | `60` |
| `--agent-cmd <command>` | AI agent command for non-command requests | `claude --dangerously-skip-permissions -p` |
| `--timeout <seconds>` | Per-request agent timeout | `600` |

Agent command resolution order: `--agent-cmd` flag > `settings.agent_cmd` in config.yaml > built-in default.

**Command requests** (shell fast-path): `status`, `scan`, `check-inbox`, `validate`. Flow: set `status: in-progress` → execute → append `## Result` → set `status: completed` → archive → write history.

**Non-command requests** (agent path): set `status: in-progress` → build prompt from request content → invoke agent with timeout → on success: archive + write history. On failure/timeout: revert `status: pending` for retry.

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
