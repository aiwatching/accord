# Accord - Design Session Context

This document captures the complete design rationale from the founding conversation.
It is intended to be read by AI coding agents (via CLAUDE.md reference) to understand
not just WHAT to build, but WHY each decision was made.

---

## Origin Story

The project originated from a real need: developing a large-scale Network Access Control
(DEMO) system (next-demo) with multiple services (demo-admin, demo-engine, device-manager)
and sub-modules within each service. The developer found that a single AI coding agent
session was insufficient for complex multi-service development because:

1. **Context window limits**: A single agent can't hold the full architecture of a large system
2. **No cross-session communication**: Agent Teams work within one session, but there's no way for independent sessions to coordinate
3. **No standard contract protocol**: When one agent needs another service to change an API, there's no mechanism to communicate that

## Key Design Decisions (and why)

### Decision 1: Git as the message bus
**Rejected alternatives**: MCP Server, message queues, databases
**Rationale**: Zero infrastructure dependency. Every developer already has Git. `git push` = send, `git pull` = receive. Full history and audit trail for free. Works offline. Works across machines. Open source projects can adopt without installing anything.

### Decision 2: Agent-agnostic protocol with thin adapters
**Rejected alternative**: Building exclusively for Claude Code
**Rationale**: AI coding tools evolve rapidly. Claude Code, Cursor, GitHub Copilot — any of them could become dominant or be replaced. The core value is in the protocol, not in any specific agent integration. Adapters are just template files that translate the protocol into each agent's native config format (CLAUDE.md, .cursorrules, AGENTS.md).

### Decision 3: OpenAPI as the external contract format
**Rejected alternatives**: Custom format, Proto files only, plain markdown
**Rationale**: Industry standard. Massive existing tooling ecosystem (Swagger UI, mock server generators, client SDK generators, validation tools). Machine-readable AND human-readable. The developer's existing workflow already uses OpenAPI-like definitions.

### Decision 4: Two-level contracts (External + Internal)
**Rejected alternative**: Only service-level contracts
**Rationale**: Within a service like device-manager, there are sub-modules (plugin, discovery, lifecycle) that also have interface boundaries. These boundaries are Java interfaces / Python Protocols, not REST APIs. The protocol needs to support both levels, using the same state machine and message format — only the contract format differs.

### Decision 5: Human-in-the-loop approval
**Rejected alternative**: Fully autonomous agent-to-agent coordination
**Rationale**: Cross-service API changes have real architectural consequences. An agent should create the request, but a human should review and approve it. This maps to how real engineering works — you don't let one service change another service's API without review.

### Decision 6: Fractal protocol (same rules at every level)
**Key insight**: The state machine (pending → approved → in-progress → completed) works identically whether you're coordinating between services (REST API changes) or between modules (Java interface changes). This keeps the framework simple and the learning curve flat.

### Decision 7: Multi-repo via Hub-and-Spoke model
**Rejected alternatives**: Git submodules (painful UX), cross-repo remotes (complex, no central view), monorepo-only (doesn't fit large orgs)
**Rationale**: A dedicated Accord Hub repo centralizes contracts and cross-service communication while each service keeps its own repo. Still zero infrastructure — just an extra Git repo. `accord sync` wraps hub pull/push. In multi-repo, `accord sync push` copies `.accord/contracts/` and `.accord/contracts/internal/` to the hub for backup. Module-level communication stays within the service repo via normal git operations.

### Decision 8: Centralized contract structure
**Key insight**: All contracts live under `.accord/contracts/` (external) and `.accord/contracts/internal/` (internal). In monorepo, there's a single copy — no collection step needed. In multi-repo, each service repo has its own `.accord/contracts/internal/` for module contracts, and `accord sync push` backs them up to the hub at `accord-hub/contracts/internal/{service}/`. This keeps the directory structure simple and predictable.

## Architecture Hierarchy (from the developer's actual project)

```
Level 0: Project Lead (human orchestrator)
│
├── Level 1: Cross-Service (Agent Teams or independent sessions)
│   ├── Frontend Service
│   ├── Backend Services ──── Accord External Contracts (OpenAPI)
│   └── QA/Test Service
│
├── Level 1.5: Backend Sub-Services (independent sessions)
│   ├── demo-admin
│   ├── demo-engine ──── Accord External Contracts (OpenAPI)
│   └── device-manager
│
├── Level 2: Within a Service (Subagents within a session)
│   └── device-manager internals
│       ├── plugin module
│       ├── discovery module ──── Accord Internal Contracts (Java interface)
│       └── lifecycle module
│
└── Level 3: Within a Module (Skills = knowledge injection)
    └── plugin module internals
        ├── SNMP plugin implementation
        └── REST plugin implementation
```

Accord operates at Levels 1, 1.5, and 2. It does NOT manage Level 3 (that's agent-internal, handled by Skills/Subagents).

## Concepts We Evaluated and Their Roles

| Concept | Role in Accord | Status |
|---------|---------------|--------|
| CLAUDE.md | Adapter artifact — injects protocol rules for Claude Code | Used in Claude Code adapter |
| Skill | Not part of Accord core — agent-internal knowledge module | Out of scope |
| Subagent | Not part of Accord core — agent-internal delegation | Out of scope |
| Agent Teams | Not part of Accord core — used within a single service session | Out of scope |
| Slash Commands | Adapter artifact — shortcuts for protocol operations | Used in Claude Code adapter |
| Hooks | Adapter artifact — auto-trigger inbox check on session start | Used in Claude Code adapter |
| MCP | Potential future adapter — richer integration option | Future extension |
| OpenAPI Spec | Core protocol — external contract format | Core |
| Git | Core protocol — transport and versioning layer | Core |
| ADR | Recommended practice — document architecture decisions | Recommended, not enforced |
| Bounded Context (DDD) | Design principle — each service/module has clear boundaries | Informs contract design |
| Contract Scanner | Protocol-layer tool — agent-agnostic scan instructions + validators. Adapters wrap it (Claude Code: Skill + slash command, Cursor: .cursorrules, Generic: markdown) | Core (protocol layer) |

## What the MVP Should Include

Priority order:
1. **PROTOCOL.md** — Finalize the protocol specification
2. **Templates** — request.md.template, contract.yaml.template, internal-contract.md.template
3. **Contract Scanner** — `protocol/scan/SCAN_INSTRUCTIONS.md` + `scan.sh` + validators (agent-agnostic scanning)
4. **init.sh** — Interactive script: `accord init --adapter claude-code --services "..."`
5. **Claude Code adapter** — CLAUDE.md.template + slash commands + contract-scanner skill
6. **Generic adapter** — Plain markdown instructions for any agent
7. **Example project** — Realistic multi-service setup showing external + internal contracts

## What the MVP Should NOT Include

- No MCP server
- No web dashboard
- No CI/CD integration
- No auto-validation tooling
- No runtime code beyond the init script
- No agent-internal orchestration features
