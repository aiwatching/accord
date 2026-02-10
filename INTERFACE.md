# Accord Standard Interface

Version: 0.1.0-draft

This document defines the minimum capabilities and behaviors required for an AI coding agent to participate in the Accord protocol. Adapter authors should reference this when building new adapters.

---

## 1. Required Capabilities

Any participating agent MUST be able to perform these operations:

| Capability   | Description                                | Example                         |
|-------------|--------------------------------------------|---------------------------------|
| READ_FILE   | Read the contents of a file at a given path | Read `.accord/comms/inbox/nac-engine/req-001.md` |
| WRITE_FILE  | Create a new file or modify an existing one | Create a request file            |
| MOVE_FILE   | Move or rename a file to a different path   | Move request to archive          |
| LIST_DIR    | List the contents of a directory            | List inbox to find new requests  |
| RUN_COMMAND | Execute a shell command                     | `git pull`, `git commit`, `git push` |

These capabilities are available in all major AI coding agents as of early 2026:
- Claude Code: Read, Write, Bash tools
- Cursor: File operations + terminal
- GitHub Copilot (Agent mode): File + terminal access
- OpenAI Codex: File + shell tools
- Aider: File editing + git operations
- Augment CLI: File + terminal access

---

## 2. Required Behaviors

Adapters must inject these behaviors into the agent's instruction set:

### 2.1 ON_START (Session Initialization)

**Trigger**: Agent session begins or conversation starts.

**Actions**:
1. Read `.accord/config.yaml` to determine repo model
2. Multi-repo: run `git pull` to sync latest changes (monorepo: comms are already local)
3. If multi-repo: run `accord sync pull` to pull from the hub repo
4. Check inbox: `.accord/comms/inbox/{own-module}/`
4. If service has sub-modules, also check: `.accord/comms/inbox/{sub-module-name}/`
5. For each request file, read the YAML frontmatter
6. Report to user:
   - Number of pending/approved requests (grouped by scope: external vs internal)
   - Summary of each (id, from, to, scope, type, priority)
7. Check recent contract changes (external and internal)

**Output to user**: Brief summary of incoming requests and contract updates (both external and internal).

### 2.2 ON_NEED_INTERFACE (Cross-Boundary Request)

**Trigger**: During implementation, the agent determines it needs an API or interface from another module that doesn't exist in their contract.

**For external requests (scope: external)**:
1. Check `.accord/contracts/{target-module}.yaml` to confirm the API doesn't exist
2. Generate a request file following the template in `.accord/comms/TEMPLATE.md`
3. Assign a unique ID: `req-{NNN}-{short-description}`
4. Set `scope: external`, `type: api-addition` (or `api-change`)
5. Set status to `pending`
6. (Optional) Add `x-accord-status: proposed` annotation to `.accord/contracts/{target-module}.yaml`
7. Place request in `.accord/comms/inbox/{target-module}/`
8. `git add` the request file and any contract annotations
9. `git commit -m "comms({target-module}): request - {summary}"`
10. Multi-repo only: `git push` (monorepo: request is already visible locally)
11. Inform user: "Created cross-service request {id} to {target-module}. Needs their approval."

**For internal requests (scope: internal)**:
1. Check `.accord/contracts/internal/{target-module}.md` to confirm the interface doesn't exist
2. Generate a request file following the template in `.accord/comms/TEMPLATE.md`
3. Assign a unique ID: `req-{NNN}-{short-description}`
4. Set `scope: internal`, `type: interface-addition` (or `interface-change`)
5. Set status to `pending`
6. Place request in `.accord/comms/inbox/{target-module}/`
7. `git add` the request file
8. `git commit -m "comms({target-module}): request - {summary}"`
9. Monorepo: no push needed. Multi-repo: `git push`.
10. Inform user: "Created internal request {id} to module {target-module}. Needs approval."

**Important**: The agent should NOT block on this request. It should continue with other work, using mock data or TODO markers for the pending API/interface.

### 2.3 ON_APPROVED_REQUEST (Processing Approved Requests)

**Trigger**: An approved request is found in the module's inbox (status: approved).

**Actions**:
1. Read the full request file
2. Present the request to the user for confirmation before starting
3. If user confirms:
   a. Update request status to `in-progress`, commit
   b. Implement the requested change
   c. Update the relevant contract:
      - External: `.accord/contracts/{own-module}.yaml` (finalize proposed changes)
      - Internal: `.accord/contracts/internal/{own-module}.md` (update interface)
   d. Move request to `.accord/comms/archive/`
   e. Commit. Multi-repo only: push.
4. If user declines:
   a. No status change; inform user the request remains approved for later

### 2.4 ON_COMPLETE (Request Completion)

**Trigger**: Implementation of an external (cross-service) or internal (cross-module) request is finished.

**Actions**:
1. Verify: Is the contract file updated (external or internal)?
2. Verify: Does the implementation match the contract?
3. Update request status to `completed`
4. Move request file from inbox to archive
5. Commit with message: `comms({own-module}): completed - {request-id}`
6. Multi-repo only: push
7. Inform user: "Completed request {id}. Contract updated."

### 2.5 ON_SCAN (Contract Generation)

**Trigger**: User requests contract generation, or during `accord init` for an existing codebase.

**Actions**:
1. Read `protocol/scan/SCAN_INSTRUCTIONS.md` for scanning rules
2. Determine scan scope from user request or `.accord/config.yaml`:
   - `--type external`: scan for REST/RPC endpoints
   - `--type internal`: scan for cross-module interfaces
   - `--type all`: both
3. Analyze source code following the detection rules for the relevant language/framework
4. Generate contract files in the correct format:
   - External: `.accord/contracts/{service}.yaml` (OpenAPI 3.0+)
   - Internal: `.accord/contracts/internal/{module}.md`
5. Mark all generated contracts with `status: draft`
6. Run validators: `protocol/scan/validators/validate-openapi.sh` and `validate-internal.sh`
7. Report results to user: "Generated {N} contracts with status: draft. Please review."
8. Do NOT auto-commit — let the user review first

**Important**: Generated contracts are `draft` and must be reviewed by a human before becoming `stable`. Other modules should not depend on `draft` contracts.

### 2.6 ON_SYNC (Multi-Repo Synchronization)

**Trigger**: User requests sync, or automatically on session start in multi-repo mode.

**`accord sync pull` actions**:
1. `cd .accord/hub && git pull`
2. Check hub's `comms/inbox/{own-service}/` for new external requests
3. Report findings to user

**`accord sync push` actions**:
1. Sync to hub:
   - Copy `.accord/contracts/{own-service}.yaml` → `hub/contracts/`
   - Copy `.accord/contracts/internal/*` → `hub/contracts/internal/{service}/`
   - Copy outgoing request files → `hub/comms/inbox/{target}/`
2. `cd .accord/hub && git add -A && git commit && git push`
3. Inform user: "Synced to hub. {N} contracts synced, {M} requests sent."

**Note**: In monorepo mode, ON_SYNC is not needed — normal `git pull/push` handles everything.

### 2.7 ON_CONFLICT (Contract Conflict)

**Trigger**: `git pull` results in a merge conflict on a contract file or request file.

**Actions**:
1. Do NOT auto-resolve the conflict
2. Inform user: "Contract conflict detected in {file}. Manual resolution required."
3. Show both versions if possible
4. Wait for user instruction

### 2.8 ON_LOG (Debug Logging)

**Trigger**: Every protocol action, when `settings.debug` is `true` in `.accord/config.yaml`.

**Setup** (at session start, if debug enabled):
1. Generate session ID: `{YYYY-MM-DD}T{HH-MM-SS}_{module}` (current time + working module)
2. Create log file: `.accord/log/{session-id}.jsonl`
3. Write a `session_start` entry

**Actions** (after each protocol operation):
1. Construct a JSON object with required fields: `ts`, `session`, `module`, `action`, `category`, `detail`
2. Add optional fields if relevant: `files`, `request_id`, `status_from`, `status_to`
3. Append the JSON object as a single line to the session's log file

**Categories and actions to log**:
- `lifecycle`: `session_start`, `session_end`, `module_selected`, `config_read`
- `comms`: `inbox_check`, `request_create`, `request_approve`, `request_reject`, `request_start`, `request_complete`, `request_archive`
- `contract`: `contract_read`, `contract_update`, `contract_annotate`, `contract_scan`, `contract_validate`
- `git`: `git_pull`, `git_push`, `git_commit`, `git_conflict`
- `scan`: `scan_start`, `scan_complete`, `scan_validate`

**What NOT to log**: source code content, user conversations, internal reasoning, secrets.

See `protocol/debug/LOG_FORMAT.md` for the complete specification.

---

## 3. Adapter Implementation Guide

### 3.1 What an Adapter Contains

```
adapters/{agent-name}/
├── {config-file}.template    # Agent's native config with Accord rules injected
├── commands/                  # Shortcut commands (if agent supports them)
│   ├── accord-check-inbox.md
│   ├── accord-send-request.md
│   └── accord-complete-request.md
└── install.sh                 # Script to install adapter into a project
```

### 3.2 Template Variables

Templates may use the following variables, replaced during `accord init`:

| Variable                      | Description                                  | Example                               |
|-------------------------------|----------------------------------------------|---------------------------------------|
| `{{PROJECT_NAME}}`            | Project name from config                     | `next-nac`                            |
| `{{SERVICE_NAME}}`             | Service name (used in contract templates only)        | `device-manager`              |
| `{{SERVICE_LIST}}`             | Comma-separated list of all services         | `frontend,nac-engine,device-manager`  |
| `{{MODULE_LIST}}`             | Comma-separated list of modules (if any)     | `plugin,discovery,lifecycle`          |
| `{{CONTRACTS_DIR}}`           | Path to external contracts directory         | `.accord/contracts/`                  |
| `{{INTERNAL_CONTRACTS_DIR}}`  | Path to internal contracts directory         | `.accord/contracts/internal/`         |
| `{{COMMS_DIR}}`               | Path to communications directory             | `.accord/comms/`                      |
| `{{SYNC_MODE}}`               | Sync mode setting                            | `on-action`                           |

### 3.3 Adapter Quality Checklist

An adapter is considered complete when:
- [ ] ON_START behavior is implemented (auto-pull + inbox check for both service and module levels)
- [ ] ON_NEED_INTERFACE behavior is implemented (request creation for both external and internal scopes)
- [ ] ON_APPROVED_REQUEST behavior is implemented (processing for both contract types)
- [ ] ON_COMPLETE behavior is implemented (archival + contract update)
- [ ] ON_CONFLICT behavior is implemented (conflict notification)
- [ ] ON_LOG behavior is implemented (debug logging when `settings.debug` is `true`)
- [ ] Install script works on macOS and Linux
- [ ] Templates use all relevant variables (including `{{MODULE_LIST}}`, `{{INTERNAL_CONTRACTS_DIR}}`)
- [ ] External test scenario (send request → approve → complete) works end-to-end
- [ ] Internal test scenario (module request → approve → complete) works end-to-end
