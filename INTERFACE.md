# Accord Standard Interface

Version: 0.1.0-draft

This document defines the minimum capabilities and behaviors required for an AI coding agent to participate in the Accord protocol. Adapter authors should reference this when building new adapters.

---

## 1. Required Capabilities

Any participating agent MUST be able to perform these operations:

| Capability   | Description                                | Example                         |
|-------------|--------------------------------------------|---------------------------------|
| READ_FILE   | Read the contents of a file at a given path | Read `.agent-comms/inbox/nac-engine/req-001.md` |
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
1. Run `git pull` to sync latest changes
2. List files in `.agent-comms/inbox/{own-team}/`
3. For each request file, read the YAML frontmatter
4. Report to user:
   - Number of pending/approved requests
   - Summary of each (id, from, type, priority)
5. Check `git log --oneline -5 -- contracts/` for recent contract changes

**Output to user**: Brief summary of incoming requests and contract updates.

### 2.2 ON_NEED_API (Cross-Team Request)

**Trigger**: During implementation, the agent determines it needs an API or capability from another team that doesn't exist in that team's contract.

**Actions**:
1. Check `contracts/{target-team}.yaml` to confirm the API doesn't exist
2. Generate a request file following the template in `.agent-comms/TEMPLATE.md`
3. Assign a unique ID: `req-{NNN}-{short-description}`
4. Set status to `pending`
5. (Optional) Add `x-accord-status: proposed` annotation to `contracts/{target-team}.yaml`
6. `git add` the request file and any contract annotations
7. `git commit -m "comms({target-team}): request - {summary}"`
8. `git push`
9. Inform user: "Created cross-team request {id} to {target-team}. Needs their approval."

**Important**: The agent should NOT block on this request. It should continue with other work, using mock data or TODO markers for the pending API.

### 2.3 ON_APPROVED_REQUEST (Processing Approved Requests)

**Trigger**: An approved request is found in the team's inbox (status: approved).

**Actions**:
1. Read the full request file
2. Present the request to the user for confirmation before starting
3. If user confirms:
   a. Update request status to `in-progress`, commit
   b. Implement the requested change
   c. Update `contracts/{own-team}.yaml` (finalize proposed changes)
   d. Move request to `.agent-comms/archive/`
   e. Commit and push
4. If user declines:
   a. No status change; inform user the request remains approved for later

### 2.4 ON_COMPLETE (Request Completion)

**Trigger**: Implementation of a cross-team request is finished.

**Actions**:
1. Verify: Is the contract file updated?
2. Verify: Does the implementation match the contract?
3. Update request status to `completed`
4. Move request file from inbox to archive
5. Commit with message: `comms({own-team}): completed - {request-id}`
6. Push
7. Inform user: "Completed request {id}. Contract updated."

### 2.5 ON_CONFLICT (Contract Conflict)

**Trigger**: `git pull` results in a merge conflict on a contract file or request file.

**Actions**:
1. Do NOT auto-resolve the conflict
2. Inform user: "Contract conflict detected in {file}. Manual resolution required."
3. Show both versions if possible
4. Wait for user instruction

---

## 3. Adapter Implementation Guide

### 3.1 What an Adapter Contains

```
adapters/{agent-name}/
├── {config-file}.template    # Agent's native config with Accord rules injected
├── commands/                  # Shortcut commands (if agent supports them)
│   ├── check-inbox.md
│   ├── send-request.md
│   └── complete-request.md
└── install.sh                 # Script to install adapter into a project
```

### 3.2 Template Variables

Templates may use the following variables, replaced during `accord init`:

| Variable           | Description                         | Example              |
|-------------------|-------------------------------------|----------------------|
| `{{PROJECT_NAME}}` | Project name from config            | `next-nac`           |
| `{{TEAM_NAME}}`    | Current team name                   | `device-manager`     |
| `{{TEAM_LIST}}`    | Comma-separated list of all teams   | `frontend,nac-engine,device-manager` |
| `{{CONTRACTS_DIR}}`| Path to contracts directory          | `contracts/`         |
| `{{COMMS_DIR}}`    | Path to agent-comms directory        | `.agent-comms/`      |

### 3.3 Adapter Quality Checklist

An adapter is considered complete when:
- [ ] ON_START behavior is implemented (auto-pull + inbox check)
- [ ] ON_NEED_API behavior is implemented (request creation)
- [ ] ON_APPROVED_REQUEST behavior is implemented (processing)
- [ ] ON_COMPLETE behavior is implemented (archival)
- [ ] ON_CONFLICT behavior is implemented (conflict notification)
- [ ] Install script works on macOS and Linux
- [ ] Templates use all relevant variables
- [ ] A test scenario (send request → approve → complete) works end-to-end
