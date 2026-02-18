# Accord Lite — Design Document

## Problem

AI coding agents work well within a single file or module but struggle with cross-module tasks in large codebases. They lack:
- Understanding of module boundaries and dependencies
- Knowledge of which modules a task affects
- Awareness of the correct order to make changes (libraries before consumers)
- Memory of public API contracts between modules

## Solution: Architecture-Aware Single Agent

Instead of orchestrating multiple agents, give a single agent a structured understanding of the codebase:

1. **Module Map** — A YAML file describing every module, its public API, dependencies, and shared resources
2. **Contracts** — Per-module Markdown files documenting the boundary (what's public, who depends on it)
3. **Execution Plans** — YAML files ordering multi-module changes by dependency graph

## Architecture

### Knowledge Base (`.accord/`)

```
.accord/
├── module-map.yaml      # Central knowledge base — all modules + deps
├── ARCHITECTURE.md      # Human-readable overview (generated)
├── contracts/           # Per-module boundary contracts
│   ├── module-a.md
│   └── module-b.md
└── plans/               # Execution plans
    ├── current-task.yaml
    └── archive/         # Completed plans
```

### Skills (`.claude/skills/`)

Two skills provide the intelligence:

**accord-scan** — Analyzes the codebase:
- Detects modules from build files (pom.xml, package.json, go.mod, etc.)
- Extracts public APIs (REST endpoints, exported interfaces, types)
- Maps dependencies (imports, REST client calls, shared resources)
- Computes topological build order
- Writes module-map.yaml, contracts/*.md, ARCHITECTURE.md

**accord-architect** — Plans and executes:
- Phase 1 (Plan): Reads architecture, determines affected modules, topological sorts, generates plan
- Phase 2 (Execute): Loads context per step, makes changes, updates contracts, records results

### Commands (`.claude/commands/`)

Five slash commands expose the skills:
- `/accord-scan [full|module <name>|diff|refresh]`
- `/accord-plan <task description>`
- `/accord-execute [all]`
- `/accord-status`
- `/accord-replan`

## Key Design Decisions

### Why Single Agent, Not Multi-Agent?

Multi-agent orchestration adds complexity: communication protocols, state synchronization, conflict resolution, message routing. For most codebases, a single agent with a good map of the terrain is simpler and more reliable.

The knowledge base approach means the agent doesn't need to rediscover the codebase structure each time — it reads the map, plans the route, and executes.

### Why Skills, Not Code?

Skills are natural-language instructions that tell the agent what to do. They're:
- **Debuggable**: you can read the SKILL.md and understand exactly what the agent will try
- **Portable**: any agent that can read Markdown can follow the instructions
- **Flexible**: the agent applies judgment rather than following rigid code paths
- **Zero dependencies**: no build step, no runtime, no package manager

### Why YAML + Markdown, Not a Database?

- Files live in Git alongside the code
- Any developer or agent can read them without tools
- Diffs show exactly what changed
- No infrastructure to deploy or maintain

### Why Contracts?

Contracts serve two purposes:
1. **Agent context**: when modifying a module, the agent loads its contract to understand the public API and who depends on it
2. **Change safety**: if a step modifies a public API, the contract must be updated, making the change visible to future steps

### Why Topological Sort for Execution?

If module A depends on module B, changing B's API first ensures A can be updated to match. Changing A first would leave it referencing a not-yet-changed API. Topological sort ensures this ordering automatically.

## Data Formats

### module-map.yaml

```yaml
version: "0.1"
scanned_at: "2026-02-18T10:00:00Z"
project:
  name: "my-project"
  root: "."

modules:
  auth-service:
    path: "services/auth"
    type: service
    description: "Handles authentication and authorization"
    public_api:
      rest:
        - method: POST
          path: "/api/auth/login"
          description: "Authenticate user"
      interfaces:
        - name: "AuthProvider"
          file: "services/auth/src/api/AuthProvider.java"
          methods:
            - "authenticate(credentials: Credentials): Token"
      types:
        - name: "Token"
          file: "services/auth/src/model/Token.java"
    depends_on:
      - user-lib
    depended_by:
      - api-gateway
    shared_resources:
      - type: database
        name: "auth_tokens"
        access: read_write

build_order:
  - user-lib
  - auth-service
  - api-gateway
```

### Contract (contracts/auth-service.md)

```markdown
---
module: auth-service
type: service
status: stable
last_scanned: "2026-02-18T10:00:00Z"
---

## Purpose
Handles authentication and authorization for the platform.

## Public API

### REST Endpoints
- `POST /api/auth/login` — Authenticate user with credentials

### Interfaces
- `AuthProvider` (services/auth/src/api/AuthProvider.java)
  - `authenticate(credentials: Credentials): Token`

### Types
- `Token` (services/auth/src/model/Token.java)

## Dependencies
- `user-lib` — user data access

## Depended By
- `api-gateway` — delegates auth checks

## Change Rules
- Stability: stable
- Before modifying public API: update this contract, then update all dependents
```

### Plan (plans/add-mfa.yaml)

```yaml
id: "add-mfa"
task: "Add multi-factor authentication support"
status: in-progress
created: "2026-02-18T10:30:00Z"
current_step: 1

steps:
  - id: step-1
    module: user-lib
    description: "Add MFA configuration to user model"
    changes:
      - "Add mfaEnabled field to User model"
      - "Add MfaConfig type"
    contracts_to_load:
      - user-lib.md
    contracts_to_update:
      - user-lib.md
    test_criteria: "User model includes MFA fields, existing tests pass"
    status: completed
    summary: "Added mfaEnabled boolean and MfaConfig type to User model"
    files_changed:
      - "libs/user/src/model/User.java"
      - "libs/user/src/model/MfaConfig.java"
    contracts_updated:
      - "user-lib.md"
    error: ""

  - id: step-2
    module: auth-service
    description: "Implement MFA verification in auth flow"
    changes:
      - "Add MFA verification step to login endpoint"
      - "Add TOTP validation service"
    contracts_to_load:
      - auth-service.md
      - user-lib.md
    contracts_to_update:
      - auth-service.md
    test_criteria: "Login returns MFA challenge when enabled"
    status: pending
    summary: ""
    files_changed: []
    contracts_updated: []
    error: ""
```

## Delivery Model

This is a **tool repository**. It provides files that get installed into user projects:

```
accord repo → init.sh → user project
                ├── .accord/          (knowledge base structure)
                ├── .claude/skills/   (scan + architect skills)
                ├── .claude/commands/ (5 slash commands)
                └── CLAUDE.md         (appended with Accord Lite rules)
```

The user's project runs independently after init — no runtime dependency on this repo.
