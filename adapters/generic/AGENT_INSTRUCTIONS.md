# Accord Protocol — Agent Instructions

These instructions enable any AI coding agent to participate in the Accord inter-agent coordination protocol. The agent needs only the ability to read/write files and run Git commands.

---

## Project Context

- **Project**: {{PROJECT_NAME}}
- **Services**: {{SERVICE_LIST}}
- **Sub-modules**: {{MODULE_LIST}}
- **External contracts directory**: `{{CONTRACTS_DIR}}`
- **Internal contracts directory**: `{{INTERNAL_CONTRACTS_DIR}}`
- **Communications directory**: `{{COMMS_DIR}}`
- **Full module config**: `.accord/config.yaml` (see `path:` fields for directory mapping)

Each service and sub-module is an **independent boundary**. Every cross-boundary change must go through the Accord protocol.

---

## CRITICAL: Module Boundary Rules

**Each module is an independent boundary. The agent works on ONE module per session.**

1. At session start, determine which module the user wants to work on — infer from their request or ask.
2. Announce: "I'll be working as the **{module}** module, only modifying files under `{path}/`"
3. The agent MUST NOT modify source code, configuration, or any files outside the working module's directory.
4. If a feature requires changes in another module's code, the agent MUST create a request via the Accord protocol.
5. When the user asks for a feature that spans multiple modules, explicitly tell them which parts can be implemented (working module) and which parts require requests to other modules.
6. The agent may READ other modules' contracts and code for reference, but NEVER edit them.

---

## 1. Session Start

At the beginning of every session, the agent should:

1. Read `.accord/config.yaml` to understand the module structure, paths, and repo model.
2. If multi-repo: run `git pull` to sync the latest changes. (Monorepo: comms are already local.)
3. Determine the working module from the user's first message.
4. Announce the working module and directory scope.
5. Check the inbox at `{{COMMS_DIR}}inbox/{your-module}/` for request files (`.md` files).
6. For each request file found, read the YAML frontmatter to extract: `id`, `from`, `to`, `scope`, `type`, `priority`, `status`.
7. Report a summary to the user:
   - Working module and directory scope
   - Number of pending requests (awaiting review)
   - Number of approved requests (ready to implement)
   - Brief details of each request
8. Check `git log --oneline -10` for recent contract changes.

---

## 2. Contracts

### External Contracts (Service-Level)

- Location: `{{CONTRACTS_DIR}}{module}.yaml` (OpenAPI 3.0 format)
- Each module owns exactly one contract file.
- The agent may **only** modify `{{CONTRACTS_DIR}}{your-module}.yaml`.
- The agent must **never** directly edit another module's contract. To propose changes, create a request (see Section 4).
- Proposed endpoint changes are annotated with `x-accord-status: proposed` and `x-accord-request: {request-id}` in the YAML.

### Internal Contracts (Module-Level)

- Location: `{{INTERNAL_CONTRACTS_DIR}}{module}.md`
- Format: Markdown with YAML frontmatter and embedded code signatures.
- The agent may only modify contracts for its own working module.

### Contract Status Lifecycle

| Status | Description |
|--------|-------------|
| `draft` | Auto-generated, needs human review |
| `stable` | Reviewed and approved, active contract |
| `proposed` | A change has been proposed via a request |
| `deprecated` | Scheduled for removal |

---

## 3. Request File Format

Request files are Markdown with YAML frontmatter. A template is available at `{{COMMS_DIR}}TEMPLATE.md`.

### Required Frontmatter Fields

| Field | Description |
|-------|-------------|
| `id` | Unique ID: `req-{NNN}-{short-description}` |
| `from` | Requesting module name |
| `to` | Target module name |
| `scope` | `external` (cross-service) or `internal` (cross-module within same service) |
| `type` | See Request Types below |
| `priority` | `low`, `medium`, `high`, or `critical` |
| `status` | `pending`, `approved`, `rejected`, `in-progress`, or `completed` |
| `created` | ISO 8601 timestamp |
| `updated` | ISO 8601 timestamp (update on each transition) |
| `related_contract` | Path to the related contract file (optional) |

### Request Types

**External**: `api-addition`, `api-change`, `api-deprecation`
**Internal**: `interface-addition`, `interface-change`, `interface-deprecation`
**Shared**: `bug-report`, `question`, `other`

### Body Sections

Each request file should contain these sections after the frontmatter:

- `## What` — Brief description (1-2 sentences)
- `## Proposed Change` — Concrete change details (API snippet or method signature)
- `## Why` — Justification and use case
- `## Impact` — What the receiving module needs to implement

---

## 4. Creating a Request (ON_NEED_INTERFACE)

When the agent needs an API or interface from another module that doesn't exist:

### External Request (cross-service)

1. Verify the API doesn't exist in `{{CONTRACTS_DIR}}{target-module}.yaml`.
2. Create a request file from `{{COMMS_DIR}}TEMPLATE.md`.
3. Set `scope: external` and appropriate `type`.
4. Assign a unique ID: check existing requests, use next sequential number.
5. Place the file at `{{COMMS_DIR}}inbox/{target-module}/{request-id}.md`.
6. Optionally annotate the target contract with `x-accord-status: proposed`.
7. Run: `git add .accord/ && git commit -m "comms({target}): request - {summary}"`
8. Multi-repo only: `git push` (monorepo: request is already visible locally).
9. Inform the user. Do **not** block — continue with mock data or TODO markers.

### Internal Request (cross-module within same service)

1. Verify the interface doesn't exist in `{{INTERNAL_CONTRACTS_DIR}}{target-module}.md`.
2. Create a request file from `{{COMMS_DIR}}TEMPLATE.md`.
3. Set `scope: internal` and appropriate `type`.
4. Place at `{{COMMS_DIR}}inbox/{target-module}/{request-id}.md`.
5. Run: `git add .accord/ && git commit -m "comms({target-module}): request - {summary}"`
6. Monorepo: no push needed. Multi-repo: `git push`.
7. Inform the user. Do **not** block.

---

## 5. State Machine

```
pending → approved      (requires human review — agent must NOT auto-approve)
pending → rejected      (with a ## Rejection Reason section)
approved → in-progress  (agent begins implementation)
in-progress → completed (contract updated, request archived)
```

### Transition Rules

1. `pending → approved`: **Human approval required.** The agent should present the request to the user and wait for their decision.
2. `pending → rejected`: A `## Rejection Reason` section must be added to the request file.
3. `in-progress → completed`: The related contract file **must** be updated before marking complete.
4. On `completed` or `rejected`: Move the request file to the archive directory.

---

## 6. Processing Approved Requests (ON_APPROVED_REQUEST)

When an approved request is found in the inbox:

1. Read the full request file.
2. Present it to the user and ask for confirmation before starting.
3. If the user confirms:
   a. Update the request status to `in-progress`, commit.
   b. Implement the requested change.
   c. Update the relevant contract:
      - External: `{{CONTRACTS_DIR}}{your-module}.yaml` (finalize proposed changes, remove annotations)
      - Internal: `{{INTERNAL_CONTRACTS_DIR}}{your-module}.md`
   d. Update the request status to `completed`.
   e. Move the request to the archive directory.
   f. Commit: `comms({your-module}): completed - {request-id}`. Multi-repo only: push.
4. If the user declines: leave the request as approved.

---

## 7. Completing a Request (ON_COMPLETE)

Before marking a request as `completed`:

1. Verify the contract file has been updated to reflect the requested change.
2. Verify the implementation matches the contract.
3. Update the request status to `completed` and the `updated` timestamp.
4. Add a `## Resolution` section to the request file.
5. Move the request from inbox to archive:
   - `{{COMMS_DIR}}inbox/{module}/` → `{{COMMS_DIR}}archive/`
6. Commit: `comms({your-module}): completed - {request-id}`. Multi-repo only: push.
7. Inform the user.

---

## 8. Multi-Module Feature Dispatch (MANDATORY)

**When the user requests a feature that spans multiple modules, the agent MUST NOT implement all changes itself.** Instead:

- **Working module's part**: implement directly
- **Other modules' parts**: create Accord requests via `{{COMMS_DIR}}inbox/{target-module}/`

If the user insists on doing it all at once: use separate agent sessions, each scoped to one module only.

---

## 9. Contract Scanning (ON_SCAN)

When the user asks to generate or update contracts:

1. Follow the scanning rules in `protocol/scan/SCAN_INSTRUCTIONS.md` (if available).
2. Analyze the source code to identify:
   - External: REST endpoints, HTTP handlers, route definitions
   - Internal: public interfaces/protocols/ABCs used across module boundaries
3. Generate contract files with `status: draft`.
4. Run format validators if available.
5. Report results to the user. Do **not** auto-commit.

---

## 10. Multi-Repo Sync (ON_SYNC)

For multi-repo projects only. Skip if using monorepo.

**Sync push**:
1. Sync contracts and requests to the hub repo.
2. Commit and push the hub repo.

**Sync pull**:
1. Pull latest from the hub repo.
2. Check the hub inbox for new requests.
3. Report findings.

---

## 11. Conflict Handling (ON_CONFLICT)

If `git pull` causes a merge conflict in any contract or request file:

1. Do **not** auto-resolve the conflict.
2. Inform the user: "Contract conflict detected in {file}. Manual resolution required."
3. Show both versions if possible.
4. Wait for user instruction.

---

## 12. Git Conventions

### Commit Messages

```
comms({module}): {action} - {summary}
contract({module}): {action} - {summary}
```

Actions: `request`, `approved`, `rejected`, `in-progress`, `completed`, `update`

### Examples

```
comms(nac-engine): request - add policy-by-type API
comms(device-manager): approved - req-001
comms(nac-engine): completed - req-001, contract updated
contract(nac-engine): update - add policy-by-type endpoint
```

---

## 13. Debug Logging

**If `settings.debug` is `true` in `.accord/config.yaml`**, the agent should write structured log entries for every protocol action it performs. Logs enable tracing and debugging of cross-boundary coordination.

### Setup

At session start, if debug is enabled:
1. Generate a session ID: `{YYYY-MM-DD}T{HH-MM-SS}_{module}` (current time + working module)
2. Create log file: `.accord/log/{session-id}.jsonl`
3. Write a `session_start` entry

### Log Format

Each log entry is one JSON object on a single line (JSONL). Required fields: `ts` (ISO 8601), `session`, `module`, `action`, `category`, `detail`. Optional: `files` (array), `request_id`, `status_from`, `status_to`.

Example:
```json
{"ts":"2026-02-10T14:30:00Z","session":"2026-02-10T14-30-00_device-manager","module":"device-manager","action":"inbox_check","category":"comms","detail":"Found 2 pending requests"}
```

### When to Log

Log after performing any of these actions:

- **lifecycle**: `session_start`, `session_end`, `module_selected`, `config_read`
- **comms**: `inbox_check`, `request_create`, `request_approve`, `request_reject`, `request_start`, `request_complete`, `request_archive`
- **contract**: `contract_read`, `contract_update`, `contract_annotate`, `contract_scan`, `contract_validate`
- **git**: `git_pull`, `git_push`, `git_commit`, `git_conflict`
- **scan**: `scan_start`, `scan_complete`, `scan_validate`

For state transitions, include `request_id`, `status_from`, and `status_to`.

See `protocol/debug/LOG_FORMAT.md` for the full specification.

---

## 14. Key Rules Summary

1. **Never** modify another module's contract directly — always use a request.
2. **Never** auto-approve requests — human review is always required.
3. A request **cannot** be marked `completed` unless the contract is updated.
4. **Always** check the inbox on session start (after `git pull`).
5. **Never** block on a pending request — continue with mock data or TODO markers.
6. **Never** auto-resolve contract merge conflicts — ask the user.
7. Contracts start as `draft` from scanning — only `stable` contracts are active.
8. **One session = one module** — never cross module boundaries.
