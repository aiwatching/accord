# Accord

**Git-based collaboration protocol for AI coding agents.**

Accord enables multiple AI coding agents — across services, sessions, and tools — to collaborate on large-scale software projects through a shared contract-based communication protocol.

---

## The Problem

AI coding agents work great within a single session. But real projects have multiple services, multiple modules, and multiple developers. When Service A needs Service B to add an API, today's options are:

- Slack message that gets lost
- A Jira ticket that nobody checks
- A meeting that could have been an async message

Accord replaces all of that with a file-based protocol that lives in your Git repo. Your agents read it, your developers review it, and Git tracks everything.

## How It Works

```
Device-Manager Agent                    NAC-Engine Agent
        │                                      │
        │  1. "I need a policy-by-type API"     │
        │  → creates request file               │
        │  → git commit (monorepo: done!)       │
        │                                       │
        │                              2. sees request in inbox
        │                              → developer approves
        │                                       │
        │                              3. implements API
        │                              → updates contract
        │                              → git commit
        │                                       │
        │  4. sees updated contract             │
        │  → codes against new API              │
        ▼                                       ▼
```

No servers. No message queues. No infrastructure. Just files and Git.

## Key Features

- **Agent-agnostic**: Works with Claude Code, Cursor, GitHub Copilot, Codex, or any agent that can read files and run git
- **Two-level contracts**: External contracts (OpenAPI) for service-level APIs + internal contracts (Java interface, Python Protocol, etc.) for module-level boundaries
- **Fractal protocol**: Same state machine and workflow at every granularity — from cross-service REST APIs to intra-service Java interfaces
- **Monorepo and multi-repo**: Works with both — Hub-and-Spoke model for multi-repo with `accord sync`
- **Zero infrastructure**: Git is the message bus, file system is the database
- **Auto-scan contracts**: `accord scan` analyzes your code and generates contract files automatically — works with any AI agent
- **Human-in-the-loop**: Agents create requests, humans approve them
- **Full traceability**: Every request, approval, and contract change is a git commit

## Quick Start

### Install

```bash
curl -fsSL https://raw.githubusercontent.com/aiwatching/accord/main/install.sh | bash
```

### Initialize your project

```bash
cd your-project
~/.accord/init.sh
```

That's it — interactive prompts will guide you through project name, services, and adapter selection.

### What it creates

Everything under `.accord/`:

```
.accord/
├── config.yaml              — Project configuration
├── contracts/               — External OpenAPI specs for each service
│   └── internal/            — Internal module-level contracts
└── comms/                   — Inbox directories for each service/module
    ├── inbox/{service}/
    ├── archive/
    └── PROTOCOL.md / TEMPLATE.md

CLAUDE.md                    — Protocol rules (Claude Code adapter)
.claude/commands/            — Slash commands (/accord-check-inbox, /accord-send-request, etc.)
```

Then start your agent. It will automatically check for incoming requests on session start.

## Project Structure (after init)

```
your-project/
├── .accord/
│   ├── config.yaml                        # Project configuration
│   ├── contracts/                         # External Contract Registry
│   │   ├── frontend.yaml                  # OpenAPI spec per service
│   │   ├── backend-api.yaml
│   │   ├── backend-engine.yaml
│   │   └── internal/                      # Internal Contract Registry
│   │       ├── plugin-registry.md         # Code-level interface contract
│   │       └── discovery-service.md
│   └── comms/                             # Communication Layer
│       ├── inbox/
│       │   ├── frontend/                  # Service-level inboxes
│       │   ├── backend-api/
│       │   ├── backend-engine/
│       │   ├── plugin/                    # Module-level inboxes
│       │   └── discovery/
│       ├── archive/
│       ├── PROTOCOL.md
│       └── TEMPLATE.md
│
├── backend-engine/                        # Service with sub-modules
│   ├── plugin/
│   └── discovery/
└── ... (your source code)
```

## Supported Agents

| Agent         | Adapter    | Status       |
|--------------|------------|--------------|
| Claude Code  | Full       | ✅ Available  |
| Generic      | Basic      | ✅ Available  |
| Cursor       | Planned    | 🔜 Coming    |
| GitHub Copilot | Planned  | 🔜 Coming    |
| OpenAI Codex | Planned    | 🔜 Coming    |

The **generic adapter** works with any agent that can read a markdown instruction file.

## Documentation

- [Protocol Specification](PROTOCOL.md) — The core protocol (state machine, formats, rules)
- [Standard Interface](INTERFACE.md) — What agents need to support
- [Design Document](docs/DESIGN.md) — Architecture rationale and design decisions

## Architecture

```
┌─────────────────────────────────┐
│         Adapter Layer           │  ← Agent-specific (CLAUDE.md, .cursorrules, etc.)
├─────────────────────────────────┤
│        Protocol Layer           │  ← Agent-agnostic (files + git)
│  Contracts │ Messages │ Tasks   │
│  (external + internal)          │
└─────────────────────────────────┘
```

The protocol layer is the core — fully agent-agnostic, based on files and Git. The same state machine and message format apply at every level: from cross-service REST APIs to intra-service code interfaces. Adapters are thin translation layers that inject protocol rules into each agent's native config format.

## Contributing

Contributions welcome, especially:

- **New adapters** for additional AI coding agents
- **Protocol improvements** based on real-world usage
- **Examples** showing Accord in different project types

## License

MIT
