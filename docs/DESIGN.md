# Accord Design Document

## 1. Problem Statement

AI coding agents (Claude Code, Cursor, GitHub Copilot, etc.) are effective within a single session for individual tasks. However, large-scale software projects require coordination across:

- **Multiple teams** (frontend, backend services, QA)
- **Multiple services/modules** (each with its own bounded context)
- **Multiple sessions** (async work across time, not just parallel)
- **Multiple people** (different developers using different agents)

There is no standard protocol for AI coding agents to collaborate asynchronously across these boundaries. Existing solutions (Claude Code's Agent Teams, claude-flow, Superpowers) focus on **intra-session orchestration** — coordinating agents within a single session. The **inter-session, cross-team coordination** problem remains unsolved.

## 2. Design Goals

1. **Agent-agnostic**: The core protocol must not depend on any specific AI coding tool
2. **Zero infrastructure**: No servers, databases, or message queues required
3. **Git-native**: Use Git as the communication transport — developers already know it
4. **Contract-first**: OpenAPI specs as the source of truth for all inter-service APIs
5. **Async by nature**: Teams work at their own pace, coordination happens through file-based messages
6. **Minimal onboarding**: A single init command should scaffold everything needed
7. **Progressive complexity**: Simple projects use basic features, complex projects layer on more

## 3. Architecture

### 3.1 Two-Layer Design

```
┌──────────────────────────────────────────────┐
│              Adapter Layer                    │
│         (per-agent implementation)            │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Claude   │ │ Cursor   │ │ Codex /      │ │
│  │ Code     │ │          │ │ Generic      │ │
│  └────┬─────┘ └────┬─────┘ └──────┬───────┘ │
│       └─────────┬──┴──────────────┘          │
│          Standard Interface                   │
├───────────────────────────────────────────────┤
│              Protocol Layer                   │
│          (fully agent-agnostic)               │
│                                               │
│  ┌─────────────┐ ┌──────────┐ ┌───────────┐ │
│  │ Contract    │ │ Message  │ │ Task      │ │
│  │ Registry    │ │ Protocol │ │ Lifecycle │ │
│  └─────────────┘ └──────────┘ └───────────┘ │
│                                               │
│             All based on Git + Files          │
└───────────────────────────────────────────────┘
```

**Protocol Layer**: Defines the file formats, directory conventions, state machine, and operational rules. Any entity (human or AI) that can read/write files and use Git can participate. This layer is the core IP of the framework.

**Adapter Layer**: Thin translation layer that injects protocol rules into agent-specific configuration formats. Each adapter is just a set of template files — no runtime code needed.

### 3.2 Protocol Layer Components

#### Contract Registry (Two Levels)

Accord supports contracts at two granularities, unified under the same protocol:

**External Contracts (Service-Level)**:
- Location: `contracts/` directory in project root
- Format: OpenAPI 3.0+ YAML (also supports gRPC Proto, GraphQL Schema)
- One file per service/team
- Defines the HTTP/RPC API boundary between services
- Can auto-generate mock servers and client SDKs

**Internal Contracts (Module-Level)**:
- Source of truth: `{module-dir}/.accord/contract.md` (each module owns its contract)
- Collected to: `{service-dir}/.accord/internal-contracts/` (auto-collected by `accord sync`)
- Backed up to: `accord-hub/internal-contracts/{service}/` (multi-repo only)
- Format: Markdown with embedded code-level interface signatures (Java interface, Python Protocol, TypeScript interface, etc.)
- One contract per module within a service
- Defines the class/method boundary between sub-modules
- Includes behavioral contracts (thread-safety, idempotency, ordering guarantees)

Both levels use the same state machine, message protocol, and Git operations. The only differences are the contract format and the granularity of the inbox directories.

#### Message Protocol
- Location: `.agent-comms/inbox/{team-name}/` directories
- Format: Markdown files with YAML frontmatter
- Each request is a single file with structured metadata
- Git operations are the transport: commit + push = send, pull = receive
- Archive completed requests to `.agent-comms/archive/`

#### Contract Scanner
- Location: `protocol/scan/`
- Agent-agnostic scanning instructions that any AI agent can follow
- Analyzes source code to auto-generate contract files (both external and internal)
- Works as a **prompt generator + output validator**: determines what to scan, generates structured instructions for the agent, then validates the output format
- Generated contracts start with `status: draft` — human review required before `stable`
- Supports multiple languages/frameworks (Java/Spring, Python/FastAPI, TypeScript/Express, Go)
- Each adapter wraps the scanner in its own way: Claude Code uses a Skill + slash command, Cursor embeds in .cursorrules, Generic adapter references SCAN_INSTRUCTIONS.md directly

#### Task Lifecycle
- State machine governing request status transitions
- States: pending → approved → in-progress → completed (or rejected)
- Transitions are recorded as file modifications + git commits
- Human approval gate between pending and approved

### 3.3 Adapter Layer

Each adapter provides:
1. **Instruction template**: Protocol rules in the agent's native config format
2. **Command templates**: Shortcuts for common protocol operations
3. **Install script**: Copies templates to the correct locations in a project

Adapter does NOT provide:
- Runtime services
- Custom tools or plugins
- Agent-internal orchestration (that's the agent's own business)

### 3.4 Standard Interface

The minimum capabilities an agent must have to participate:

| Capability   | Description                              |
|-------------|------------------------------------------|
| READ_FILE   | Read file content at a given path         |
| WRITE_FILE  | Create or modify a file                   |
| MOVE_FILE   | Move/rename a file                        |
| LIST_DIR    | List directory contents                   |
| RUN_COMMAND | Execute shell commands (git operations)   |

These are universal across all modern AI coding agents.

Required behaviors (injected by adapter):

| Behavior     | Trigger                                           |
|-------------|---------------------------------------------------|
| ON_START    | Session start → git pull + check inbox             |
| ON_NEED_API | Need another team's API → create request file      |
| ON_COMPLETE | Finished cross-team task → archive + update contract |
| ON_CONFLICT | Contract conflict detected → notify user           |

## 4. Repository Models

Accord supports two Git topologies:

### 4.1 Monorepo

All services in one repo. Simplest setup. All `.agent-comms/` and `contracts/` are in the same repo.

### 4.2 Multi-Repo (Hub-and-Spoke)

Each service has its own repo. A shared **Accord Hub** repo centralizes contracts and cross-service communication.

```
┌─────────────────────────────────────────────────┐
│                  Accord Hub                      │
│  (shared repo: contracts + cross-service comms)  │
│                                                  │
│  contracts/    .agent-comms/    internal-contracts/
│                                (backup copies)    │
└───────┬──────────────┬────────────────┬──────────┘
        │              │                │
   accord sync    accord sync      accord sync
        │              │                │
┌───────▼──────┐ ┌─────▼──────┐ ┌──────▼───────┐
│device-manager│ │ nac-engine │ │  nac-admin   │
│   (own repo) │ │ (own repo) │ │  (own repo)  │
│              │ │            │ │              │
│ plugin/      │ │            │ │              │
│  └.accord/   │ │            │ │              │
│   └contract  │ │            │ │              │
│ discovery/   │ │            │ │              │
│  └.accord/   │ │            │ │              │
│   └contract  │ │            │ │              │
└──────────────┘ └────────────┘ └──────────────┘
```

### 4.3 Contract Collection (Multi-Repo)

Internal contracts are owned by modules but collected upward for backup:

```
plugin/.accord/contract.md          → source of truth (module edits here)
        ↓ accord sync collect
.accord/internal-contracts/plugin.md → service-root collected copy
        ↓ accord sync push
accord-hub/internal-contracts/device-manager/plugin.md → hub backup
```

### 4.4 Scope Hierarchy

```
Project (Accord manages cross-team + cross-module coordination)
│
├── Team A ←──── External Contract (OpenAPI) ────→ Team B
│   │            (via hub in multi-repo)
│   │
│   ├── Module X ←── Internal Contract (Java interface) ──→ Module Y
│   │                 (within same service repo)
│   │
│   └── Module Z
│
└── Team C
```

The same protocol (request → approve → implement → complete) applies at both levels. An agent working on Module X that needs a new method from Module Y follows the exact same workflow as Team A requesting a new API from Team B.

## 5. Request File Format

### External Request (Service-Level)

```yaml
---
id: req-001-add-policy-api
from: device-manager
to: nac-engine
scope: external
type: api-addition
priority: medium
status: pending
created: 2026-02-09T10:30:00Z
updated: 2026-02-09T10:30:00Z
related_contract: contracts/nac-engine.yaml
---

## What
Need endpoint to query policies by device type.

## Proposed Change
GET /api/policies/by-device-type/{type}
Response: { policies: Policy[], default_action: "allow" | "deny" }

## Why
After device discovery, need to immediately look up default policy for that device type.

## Impact
- PolicyController: new endpoint
- PolicyService: new findByDeviceType method
- PolicyRepository: new query
```

### Internal Request (Module-Level)

```yaml
---
id: req-012-plugin-priority-sort
from: discovery
to: plugin
scope: internal
type: interface-change
priority: medium
status: pending
created: 2026-02-09T14:00:00Z
updated: 2026-02-09T14:00:00Z
related_contract: device-manager/.accord/internal-contracts/plugin-registry.md
---

## What
Discovery module needs PluginRegistry to support priority-sorted queries.

## Proposed Change
```java
// Add to PluginRegistry interface
List<DevicePlugin> findByDeviceTypeSorted(String deviceType, SortOrder order);
```

## Why
When multiple plugins handle the same device type, need to select by priority.

## Impact
- PluginRegistry interface: add one method
- PluginRegistryImpl: implement with Comparator-based sorting
- No breaking change to existing methods
```

## 6. State Machine

```
                    ┌──────────┐
                    │ pending  │ ← Created by requesting team
                    └────┬─────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        ┌──────────┐         ┌──────────┐
        │ approved │         │ rejected │ ← With reason
        └────┬─────┘         └──────────┘
             │
             ▼
      ┌─────────────┐
      │ in-progress │ ← Receiving team starts work
      └──────┬──────┘
             │
             ▼
      ┌───────────┐
      │ completed │ ← Contract updated, request archived
      └───────────┘
```

Rules:
- Only the **receiving team** (or their human) can transition pending → approved/rejected
- Only the **receiving team's agent** can transition approved → in-progress → completed
- The **requesting team** can withdraw (delete) a pending request
- completed requests are moved to `.agent-comms/archive/`
- rejected requests are moved to `.agent-comms/archive/` with rejection reason

## 7. Git Conventions

### Commit Messages
```
comms({target-team}): {action} - {summary}
```
Examples:
- `comms(nac-engine): request - add policy-by-type API`
- `comms(device-manager): approved - req-001`
- `comms(nac-engine): completed - req-001, contract updated`
- `contract(nac-engine): update v2 - add policy-by-type endpoint`

### Branch Strategy
- Each team can work on their own branch
- Contract changes should be on a shared branch (e.g., main or develop)
- Request files should be committed to the shared branch so all teams can see them

## 8. Workflow Example

### Scenario: device-manager needs nac-engine to add an API

**Step 1: device-manager agent creates request**
```bash
# Agent creates: .agent-comms/inbox/nac-engine/req-001-policy-by-type.md
# Agent updates: contracts/nac-engine.yaml (marks new endpoint as PROPOSED)
# Agent commits: "comms(nac-engine): request - add policy-by-type API"
# Agent pushes
```

**Step 2: nac-engine developer gets notified**
```bash
# On next session start, agent runs: git pull
# Agent checks: .agent-comms/inbox/nac-engine/
# Agent reports: "You have 1 pending request from device-manager"
# Developer reviews and approves (changes status to 'approved')
```

**Step 3: nac-engine agent implements**
```bash
# Agent reads the approved request
# Agent implements the endpoint
# Agent updates contracts/nac-engine.yaml (removes PROPOSED marker)
# Agent moves request to .agent-comms/archive/
# Agent commits: "comms(nac-engine): completed - req-001, contract updated"
# Agent pushes
```

**Step 4: device-manager picks up the change**
```bash
# On next session start, agent runs: git pull
# Agent sees contract update in git log
# Agent can now code against the new API
```

## 9. Relationship to Existing Tools

### What Accord replaces
- Ad-hoc Slack/Teams messages about API changes between teams
- Manual tracking of "who needs what from whom"
- Verbal agreements about interface contracts

### What Accord does NOT replace
- Agent-internal orchestration (Claude Code's subagents, skills, agent teams)
- IDE-specific features
- CI/CD pipelines
- Code review processes

### How Accord works WITH existing tools
- **Claude Code Agent Teams**: Use within a single team for parallel development. Accord coordinates BETWEEN teams.
- **OpenAPI tooling**: Accord uses standard OpenAPI specs, so all existing tools (Swagger UI, mock generators, SDK generators) work out of the box.
- **Git workflows**: Accord piggybacks on your existing Git workflow. It doesn't impose a branching strategy.

## 10. Key Design Insight: Fractal Protocol

The most important architectural decision in Accord is that **the same protocol applies at every granularity level**:

```
Organization level:  Team A ←→ Team B        (External contracts, OpenAPI)
Service level:       Module X ←→ Module Y    (Internal contracts, Java interface)
```

The state machine is identical. The request format is identical (with a `scope` field). The Git operations are identical. The only things that change are:
- The contract format (OpenAPI vs code-level interface)
- The inbox granularity (team-level vs module-level)

This means:
1. Developers learn one protocol, apply it everywhere
2. The framework codebase stays simple — no special cases for different scopes
3. New granularity levels can be added without protocol changes

## 11. Future Extensions (Not in MVP)

- **MCP Server adapter**: For teams that want richer integration than file-based
- **Dashboard**: Web UI to visualize cross-team request status
- **Auto-validation**: CI hook that validates contracts and request format
- **Conflict detection**: Automatic detection of breaking contract changes
- **Metrics**: Track request turnaround time, team responsiveness
- **Skill packs**: Pre-built skills for common patterns (REST CRUD, event-driven, etc.)
- **Mock generation**: Auto-generate mock servers from OpenAPI contracts (can chain with `accord scan` — scan generates the contract, mock generator creates a server from it)
- **Contract diff**: Visual diff tool for contract changes across versions
