# Accord Protocol Specification

Version: 0.1.0-draft

This document defines the Accord inter-agent communication protocol. The protocol is fully agent-agnostic — any AI coding agent or human that can read/write files and operate Git can participate.

---

## 1. Directory Structure

When Accord is initialized in a project, the following directory structure is created:

```
{project-root}/
├── contracts/                         # Contract Registry
│   └── {team-name}.yaml              # One OpenAPI spec per team/service
│
├── .agent-comms/                      # Communication directory
│   ├── inbox/
│   │   └── {team-name}/              # One inbox per team
│   │       └── {request-id}.md       # Request files
│   ├── archive/                       # Completed/rejected requests
│   │   └── {request-id}.md
│   ├── PROTOCOL.md                    # Copy of this protocol (for agent reference)
│   └── TEMPLATE.md                    # Request file template
│
└── .accord/                           # Accord configuration
    ├── config.yaml                    # Team definitions and settings
    └── adapter/                       # Active adapter files
```

### Naming Conventions
- Team names: lowercase, hyphenated (e.g., `device-manager`, `nac-engine`)
- Request IDs: `req-{NNN}-{short-description}` (e.g., `req-001-add-policy-api`)
- Contract files: `{team-name}.yaml`

---

## 2. Contract Registry

### 2.1 Format
All contracts use OpenAPI 3.0+ YAML format.

### 2.2 Rules
1. Each team/service owns exactly one contract file in `contracts/`
2. A team may ONLY modify its own contract file
3. To propose changes to another team's contract, use the Message Protocol (Section 3)
4. Proposed changes are annotated with `x-accord-status: proposed` in the OpenAPI spec
5. Once a request is completed, the `x-accord-status` annotation is removed

### 2.3 Contract Annotation Example
```yaml
paths:
  /api/policies/by-device-type/{type}:
    x-accord-status: proposed          # ← Accord annotation
    x-accord-request: req-001          # ← Links to request
    get:
      summary: Get policies by device type
      # ...
```

### 2.4 Versioning
Contracts are versioned through Git. There is no separate version number — the Git commit hash serves as the version identifier. Breaking changes should be documented in the request file's Impact section.

---

## 3. Message Protocol

### 3.1 Request File Format

Request files are Markdown with YAML frontmatter. Stored in `.agent-comms/inbox/{target-team}/`.

```yaml
---
id: req-001-add-policy-api
from: device-manager
to: nac-engine
type: api-addition
priority: medium
status: pending
created: 2026-02-09T10:30:00Z
updated: 2026-02-09T10:30:00Z
related_contract: contracts/nac-engine.yaml
---

## What
[Brief description of the request]

## Proposed Change
[Concrete change, preferably in OpenAPI format]

## Why
[Justification]

## Impact
[What the receiving team needs to implement]
```

### 3.2 Field Definitions

| Field              | Required | Description                                    |
|-------------------|----------|------------------------------------------------|
| id                | Yes      | Unique identifier: `req-{NNN}-{description}`   |
| from              | Yes      | Requesting team name                            |
| to                | Yes      | Target team name                                |
| type              | Yes      | One of: api-addition, api-change, api-deprecation, bug-report, question, other |
| priority          | Yes      | One of: low, medium, high, critical             |
| status            | Yes      | One of: pending, approved, rejected, in-progress, completed |
| created           | Yes      | ISO 8601 timestamp                              |
| updated           | Yes      | ISO 8601 timestamp, updated on each transition  |
| related_contract  | No       | Path to the related contract file               |

### 3.3 Request Types

| Type             | Description                                         |
|-----------------|-----------------------------------------------------|
| api-addition    | Request to add a new endpoint or capability          |
| api-change      | Request to modify an existing endpoint               |
| api-deprecation | Notification that a consuming team will stop using an endpoint |
| bug-report      | Report an issue with an existing contract/API         |
| question        | Ask for clarification about a contract                |
| other           | Anything that doesn't fit above                       |

---

## 4. State Machine

### 4.1 States

| State        | Description                                      |
|-------------|--------------------------------------------------|
| pending     | Request created, awaiting review                  |
| approved    | Reviewed and accepted, ready for implementation   |
| rejected    | Reviewed and declined                             |
| in-progress | Implementation has started                        |
| completed   | Implementation done, contract updated             |

### 4.2 Transitions

```
pending → approved      (by: receiving team human/agent, requires review)
pending → rejected      (by: receiving team human/agent, requires reason)
pending → [deleted]     (by: requesting team, withdrawal)
approved → in-progress  (by: receiving team agent, starts implementation)
in-progress → completed (by: receiving team agent, contract updated)
in-progress → pending   (by: either team, if requirements changed)
```

### 4.3 Transition Rules
1. **Human approval required**: `pending → approved` MUST involve a human decision. Agents should NOT auto-approve requests.
2. **Rejection requires reason**: When rejecting, add a `## Rejection Reason` section to the request file.
3. **Completion requires contract update**: A request cannot be marked `completed` unless the related contract file has been updated accordingly.
4. **Archive on terminal states**: When a request reaches `completed` or `rejected`, move it to `.agent-comms/archive/`.

---

## 5. Git Operations

### 5.1 Sending a Request (requesting team)
```
1. Create request file in .agent-comms/inbox/{target-team}/
2. (Optional) Annotate proposed changes in contracts/{target}.yaml
3. git add .agent-comms/ contracts/
4. git commit -m "comms({target}): request - {summary}"
5. git push
```

### 5.2 Receiving Requests (target team)
```
1. git pull
2. Check .agent-comms/inbox/{own-team}/ for new or updated files
3. Report findings to user
```

### 5.3 Approving/Rejecting (target team)
```
1. Update status field in request file
2. (If rejected) Add rejection reason
3. git add .agent-comms/
4. git commit -m "comms({own-team}): {approved|rejected} - {request-id}"
5. git push
```

### 5.4 Completing a Request (target team)
```
1. Implement the requested change
2. Update contracts/{own-team}.yaml (remove x-accord-status annotation)
3. Update request file status to completed
4. Move request to .agent-comms/archive/
5. git add .
6. git commit -m "comms({own-team}): completed - {request-id}"
7. git push
```

### 5.5 Commit Message Convention
```
comms({team}): {action} - {summary}
contract({team}): {action} - {summary}
```

Actions: `request`, `approved`, `rejected`, `in-progress`, `completed`, `update`

---

## 6. Configuration

### 6.1 Config File: `.accord/config.yaml`

```yaml
version: "0.1"
project:
  name: next-nac
  description: "Next-generation Network Access Control system"

teams:
  - name: frontend
    description: "Web management UI"
    contract: contracts/frontend-api.yaml

  - name: nac-engine
    description: "Policy evaluation and enforcement engine"
    contract: contracts/nac-engine.yaml

  - name: device-manager
    description: "Device discovery, lifecycle, and plugin management"
    contract: contracts/device-manager.yaml

  - name: nac-admin
    description: "Administration, RBAC, and audit logging"
    contract: contracts/nac-admin.yaml

settings:
  auto_pull_on_start: true
  require_human_approval: true
  archive_completed: true
```

---

## 7. Protocol Compliance

An agent or human is considered "Accord-compliant" if it:

1. Reads and respects existing contract files before making cross-service changes
2. Creates properly formatted request files for cross-team needs
3. Does not modify another team's contract file directly
4. Follows the state machine transitions defined in Section 4
5. Uses the Git conventions defined in Section 5
6. Checks its inbox on session start
