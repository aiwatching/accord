# Accord Protocol Specification

Version: 0.1.0-draft

This document defines the Accord inter-agent communication protocol. The protocol is fully agent-agnostic — any AI coding agent or human that can read/write files and operate Git can participate.

---

## 1. Directory Structure

When Accord is initialized in a project, the following directory structure is created:

```
{project-root}/
├── contracts/                         # External Contract Registry (service-level)
│   └── {team-name}.yaml              # One OpenAPI spec per team/service
│
├── .agent-comms/                      # Communication directory
│   ├── inbox/
│   │   └── {team-name-or-module}/    # One inbox per team or sub-module
│   │       └── {request-id}.md       # Request files
│   ├── archive/                       # Completed/rejected requests
│   │   └── {request-id}.md
│   ├── PROTOCOL.md                    # Copy of this protocol (for agent reference)
│   └── TEMPLATE.md                    # Request file template
│
├── .accord/                           # Accord configuration
│   ├── config.yaml                    # Team definitions and settings
│   └── adapter/                       # Active adapter files
│
├── protocol/scan/                     # Contract Scanner (agent-agnostic)
│   ├── SCAN_INSTRUCTIONS.md           # Scanning rules and output format
│   ├── scan.sh                        # Entry point script
│   └── validators/                    # Output format validators
│
└── {service-dir}/                     # Within a service/module
    └── .accord/
        └── internal-contracts/        # Internal Contract Registry (module-level)
            └── {module-name}.md       # Code-level interface contracts
```

### Naming Conventions
- Team names: lowercase, hyphenated (e.g., `device-manager`, `nac-engine`)
- Module names: lowercase, hyphenated (e.g., `plugin`, `discovery`, `lifecycle`)
- Request IDs: `req-{NNN}-{short-description}` (e.g., `req-001-add-policy-api`)
- External contract files: `{team-name}.yaml`
- Internal contract files: `{module-name}.md`

---

## 2. Contract Registry

Accord supports two levels of contracts, unified under the same protocol.

### 2.1 External Contracts (Service-Level)

External contracts define the API boundary between services or teams. Other teams interact with your service exclusively through this contract.

**Format**: OpenAPI 3.0+ YAML, gRPC Proto, or GraphQL Schema.

**Location**: `contracts/{team-name}.yaml`

**Rules**:
1. Each team/service owns exactly one external contract file in `contracts/`
2. A team may ONLY modify its own contract file
3. To propose changes to another team's contract, use the Message Protocol (Section 3)
4. Proposed changes are annotated with `x-accord-status: proposed` in the spec
5. Once a request is completed, the `x-accord-status` annotation is removed

**Annotation Example**:
```yaml
paths:
  /api/policies/by-device-type/{type}:
    x-accord-status: proposed          # ← Accord annotation
    x-accord-request: req-001          # ← Links to request
    get:
      summary: Get policies by device type
      # ...
```

### 2.2 Internal Contracts (Module-Level)

Internal contracts define the code-level interface boundary between sub-modules within a service. Other modules interact with your module exclusively through this contract.

**Format**: Markdown with embedded interface signatures (Java interface, Python Protocol/ABC, TypeScript interface, etc.)

**Location**: `{service-dir}/.accord/internal-contracts/{module-name}.md`

**Rules**:
1. Each module owns its internal contract file
2. A module may ONLY modify its own contract
3. To propose changes to another module's contract, use the same Message Protocol (Section 3)
4. Proposed changes are annotated with `x-accord-status: proposed` in the frontmatter

**Internal Contract File Format**:

```markdown
---
id: plugin-registry
module: plugin
language: java
type: interface
status: stable                        # draft | stable | proposed | deprecated
---

## Interface

​```java
public interface PluginRegistry {

    void register(DevicePlugin plugin);

    Optional<DevicePlugin> findByDeviceType(String deviceType);

    List<DevicePlugin> listAll();
}
​```

## Behavioral Contract
- register() is idempotent for same plugin ID + same version
- findByDeviceType() checks plugins in priority order
- Thread-safe: all methods can be called concurrently

## Used By
- discovery module: calls findByDeviceType() after device scan
- lifecycle module: calls listAll() for health checks
```

### 2.3 Supported Contract Types

| Contract Type          | Format              | Scope                  |
|-----------------------|---------------------|------------------------|
| openapi               | OpenAPI 3.0+ YAML   | Service-level REST API |
| grpc                  | Proto file           | Service-level RPC      |
| graphql               | GraphQL schema       | Service-level GraphQL  |
| java-interface        | Java interface/class | Module-level (Java)    |
| python-protocol       | Python Protocol/ABC  | Module-level (Python)  |
| typescript-interface  | TypeScript interface | Module-level (TS)      |
| golang-interface      | Go interface         | Module-level (Go)      |

### 2.4 Contract Status Lifecycle

| Status     | Description                                                    |
|-----------|----------------------------------------------------------------|
| draft     | Auto-generated by `accord scan`. Requires human review.        |
| stable    | Reviewed and approved. Active contract.                        |
| proposed  | A change has been proposed via a request. Pending approval.    |
| deprecated| Scheduled for removal. Consumers should migrate.              |

Contracts generated by scanning start as `draft`. A human must review and change to `stable` before they are considered active contracts. Other teams/modules should not depend on `draft` contracts.

### 2.5 Versioning
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
| from              | Yes      | Requesting team or module name                  |
| to                | Yes      | Target team or module name                      |
| scope             | Yes      | One of: external, internal                      |
| type              | Yes      | See Section 3.3 for valid types                 |
| priority          | Yes      | One of: low, medium, high, critical             |
| status            | Yes      | One of: pending, approved, rejected, in-progress, completed |
| created           | Yes      | ISO 8601 timestamp                              |
| updated           | Yes      | ISO 8601 timestamp, updated on each transition  |
| related_contract  | No       | Path to the related contract file               |

### 3.3 Request Types

**External (service-level):**

| Type             | Description                                         |
|-----------------|-----------------------------------------------------|
| api-addition    | Request to add a new endpoint or capability          |
| api-change      | Request to modify an existing endpoint               |
| api-deprecation | Notification that a consuming team will stop using an endpoint |

**Internal (module-level):**

| Type                  | Description                                    |
|----------------------|------------------------------------------------|
| interface-addition   | Request to add a new method or class to a module interface |
| interface-change     | Request to modify an existing module interface  |
| interface-deprecation| Notification that a consuming module will stop using an interface method |

**Shared (both scopes):**

| Type             | Description                                         |
|-----------------|-----------------------------------------------------|
| bug-report      | Report an issue with an existing contract/API/interface |
| question        | Ask for clarification about a contract               |
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
    contracts:
      external: contracts/frontend-api.yaml

  - name: nac-engine
    description: "Policy evaluation and enforcement engine"
    contracts:
      external: contracts/nac-engine.yaml

  - name: device-manager
    description: "Device discovery, lifecycle, and plugin management"
    contracts:
      external: contracts/device-manager.yaml
      internal:
        - path: device-manager/.accord/internal-contracts/plugin-registry.md
          module: plugin
          type: java-interface
        - path: device-manager/.accord/internal-contracts/discovery-service.md
          module: discovery
          type: java-interface
        - path: device-manager/.accord/internal-contracts/device-lifecycle.md
          module: lifecycle
          type: java-interface

  - name: nac-admin
    description: "Administration, RBAC, and audit logging"
    contracts:
      external: contracts/nac-admin.yaml

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
