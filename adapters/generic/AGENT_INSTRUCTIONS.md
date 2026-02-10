# Accord Protocol — Agent Instructions

These instructions enable any AI coding agent to participate in the Accord inter-agent coordination protocol. The agent needs only the ability to read/write files and run Git commands.

---

## Project Context

- **Project**: {{PROJECT_NAME}}
- **Your team**: {{TEAM_NAME}}
- **All teams**: {{TEAM_LIST}}
- **Your modules**: {{MODULE_LIST}}
- **External contracts directory**: `{{CONTRACTS_DIR}}`
- **Internal contracts directory**: `{{INTERNAL_CONTRACTS_DIR}}`
- **Communications directory**: `{{COMMS_DIR}}`

---

## 1. Session Start

At the beginning of every session, the agent should:

1. Run `git pull` to sync the latest changes.
2. Check the external inbox at `{{COMMS_DIR}}inbox/{{TEAM_NAME}}/` for request files (`.md` files).
3. If the team has sub-modules, check each module inbox at `{{TEAM_NAME}}/.agent-comms/inbox/{module}/`.
4. For each request file found, read the YAML frontmatter to extract: `id`, `from`, `to`, `scope`, `type`, `priority`, `status`.
5. Report a summary to the user:
   - Number of pending requests (awaiting review)
   - Number of approved requests (ready to implement)
   - Brief details of each request
6. Check `git log --oneline -10` for recent contract changes.

---

## 2. Contracts

### External Contracts (Service-Level)

- Location: `{{CONTRACTS_DIR}}{team-name}.yaml` (OpenAPI 3.0 format)
- Each team owns exactly one contract file.
- The agent may **only** modify `{{CONTRACTS_DIR}}{{TEAM_NAME}}.yaml`.
- The agent must **never** directly edit another team's contract. To propose changes, create a request (see Section 4).
- Proposed endpoint changes are annotated with `x-accord-status: proposed` and `x-accord-request: {request-id}` in the YAML.

### Internal Contracts (Module-Level)

- Source of truth: `{{TEAM_NAME}}/{module}/.accord/contract.md`
- Collected copies: `{{INTERNAL_CONTRACTS_DIR}}{module}.md`
- Format: Markdown with YAML frontmatter and embedded code signatures.
- The agent may only modify contracts for its own modules.
- Never edit collected copies directly — edit the source, then collect.

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
| `from` | Requesting team or module name |
| `to` | Target team or module name |
| `scope` | `external` (cross-team) or `internal` (cross-module) |
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
- `## Impact` — What the receiving team/module needs to implement

---

## 4. Creating a Request (ON_NEED_INTERFACE)

When the agent needs an API or interface from another team/module that doesn't exist:

### External Request (cross-team)

1. Verify the API doesn't exist in `{{CONTRACTS_DIR}}{target-team}.yaml`.
2. Create a request file from `{{COMMS_DIR}}TEMPLATE.md`.
3. Set `scope: external` and appropriate `type`.
4. Assign a unique ID: check existing requests, use next sequential number.
5. Place the file at `{{COMMS_DIR}}inbox/{target-team}/{request-id}.md`.
6. Optionally annotate the target contract with `x-accord-status: proposed`.
7. Run: `git add {{COMMS_DIR}} {{CONTRACTS_DIR}} && git commit -m "comms({target}): request - {summary}" && git push`
8. Inform the user. Do **not** block — continue with mock data or TODO markers.

### Internal Request (cross-module)

1. Verify the interface doesn't exist in `{{INTERNAL_CONTRACTS_DIR}}{target-module}.md`.
2. Create a request file from `{{COMMS_DIR}}TEMPLATE.md`.
3. Set `scope: internal` and appropriate `type`.
4. Place at `{{TEAM_NAME}}/.agent-comms/inbox/{target-module}/{request-id}.md`.
5. Run: `git add . && git commit -m "comms({target-module}): request - {summary}" && git push`
6. Inform the user. Do **not** block.

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
   a. Update the request status to `in-progress`, commit and push.
   b. Implement the requested change.
   c. Update the relevant contract:
      - External: `{{CONTRACTS_DIR}}{{TEAM_NAME}}.yaml` (finalize proposed changes, remove annotations)
      - Internal: both the source contract and collected copy
   d. Update the request status to `completed`.
   e. Move the request to the archive directory.
   f. Commit: `comms({{TEAM_NAME}}): completed - {request-id}` and push.
4. If the user declines: leave the request as approved.

---

## 7. Completing a Request (ON_COMPLETE)

Before marking a request as `completed`:

1. Verify the contract file has been updated to reflect the requested change.
2. Verify the implementation matches the contract.
3. Update the request status to `completed` and the `updated` timestamp.
4. Add a `## Resolution` section to the request file.
5. Move the request from inbox to archive:
   - External: `{{COMMS_DIR}}inbox/{team}/` → `{{COMMS_DIR}}archive/`
   - Internal: `{{TEAM_NAME}}/.agent-comms/inbox/{module}/` → `{{TEAM_NAME}}/.agent-comms/archive/`
6. Commit and push: `comms({{TEAM_NAME}}): completed - {request-id}`
7. Inform the user.

---

## 8. Contract Scanning (ON_SCAN)

When the user asks to generate or update contracts:

1. Follow the scanning rules in `protocol/scan/SCAN_INSTRUCTIONS.md` (if available).
2. Analyze the source code to identify:
   - External: REST endpoints, HTTP handlers, route definitions
   - Internal: public interfaces/protocols/ABCs used across module boundaries
3. Generate contract files with `status: draft`.
4. Run format validators if available.
5. Report results to the user. Do **not** auto-commit.

---

## 9. Multi-Repo Sync (ON_SYNC)

For multi-repo projects only. Skip if using monorepo.

**Sync push**:
1. Collect module contracts: copy each `{module}/.accord/contract.md` → `.accord/internal-contracts/{module}.md`
2. Sync to hub: copy contracts and outgoing requests to the hub repo.
3. Commit and push the hub repo.

**Sync pull**:
1. Pull latest from the hub repo.
2. Check the hub inbox for new requests.
3. Report findings.

---

## 10. Conflict Handling (ON_CONFLICT)

If `git pull` causes a merge conflict in any contract or request file:

1. Do **not** auto-resolve the conflict.
2. Inform the user: "Contract conflict detected in {file}. Manual resolution required."
3. Show both versions if possible.
4. Wait for user instruction.

---

## 11. Git Conventions

### Commit Messages

```
comms({team-or-module}): {action} - {summary}
contract({team-or-module}): {action} - {summary}
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

## 12. Key Rules Summary

1. **Never** modify another team's contract directly — always use a request.
2. **Never** auto-approve requests — human review is always required.
3. A request **cannot** be marked `completed` unless the contract is updated.
4. **Always** check the inbox on session start (after `git pull`).
5. **Never** block on a pending request — continue with mock data or TODO markers.
6. **Never** auto-resolve contract merge conflicts — ask the user.
7. Contracts start as `draft` from scanning — only `stable` contracts are active.
