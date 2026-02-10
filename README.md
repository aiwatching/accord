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
- **Module registry**: Each module declares what it owns, what it can do, and what it depends on — agents use this for task routing
- **Fractal protocol**: Same state machine and workflow at every granularity — from cross-service REST APIs to intra-service Java interfaces
- **Monorepo and multi-repo**: Works with both — Hub-and-Spoke model for multi-repo with `accord sync`
- **Zero infrastructure**: Git is the message bus, file system is the database
- **Auto-scan contracts**: `accord scan` analyzes your code and generates contract files automatically — works with any AI agent
- **Human-in-the-loop**: Agents create requests, humans approve them
- **Full traceability**: Every request, approval, and contract change is a git commit
- **Debug logging**: Optional JSONL logs trace every protocol action across sessions

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

Subsequent runs detect the existing config and exit early. Use `--force` to re-initialize (existing contracts are preserved).

### What it creates

Everything under `.accord/`:

```
.accord/
├── config.yaml              — Project configuration
├── contracts/               — External OpenAPI specs for each service
│   └── internal/            — Internal module-level contracts
├── registry/                — Module registry (ownership, capabilities, dependencies)
│   ├── frontend.md
│   └── device-manager.md
└── comms/                   — Inbox directories for each service/module
    ├── inbox/{service}/
    ├── archive/
    └── PROTOCOL.md / TEMPLATE.md

CLAUDE.md                    — Protocol rules (Claude Code adapter)
.claude/commands/            — Slash commands (/accord-check-inbox, /accord-send-request, etc.)
```

Then start your agent. It will automatically check for incoming requests on session start.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Adapter Layer                       │
│            (per-agent implementation)                │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Claude   │  │ Cursor   │  │ Codex / Generic   │ │
│  │ Code     │  │          │  │                   │ │
│  └────┬─────┘  └────┬─────┘  └─────────┬─────────┘ │
│       └──────────┬───┴─────────────────┘            │
│           Standard Interface                        │
├─────────────────────────────────────────────────────┤
│                  Protocol Layer                      │
│             (fully agent-agnostic)                   │
│                                                     │
│  ┌───────────┐ ┌──────────┐ ┌─────────┐ ┌────────┐ │
│  │ Contract  │ │ Message  │ │  Task   │ │ Module │ │
│  │ Registry  │ │ Protocol │ │Lifecycle│ │Registry│ │
│  └───────────┘ └──────────┘ └─────────┘ └────────┘ │
│                                                     │
│             All based on Git + Files                │
└─────────────────────────────────────────────────────┘
```

The protocol layer is the core — fully agent-agnostic, based on files and Git. The same state machine and message format apply at every level: from cross-service REST APIs to intra-service code interfaces. Adapters are thin translation layers that inject protocol rules into each agent's native config format.

### Protocol Layer Components

**Contract Registry** — Two levels of contracts under the same protocol:
- External contracts (`.accord/contracts/{service}.yaml`): OpenAPI specs for service-level APIs
- Internal contracts (`.accord/contracts/internal/{module}.md`): Code-level interfaces for module boundaries

**Module Registry** — Lightweight directory of module ownership and capabilities:
- Each service/module has `.accord/registry/{name}.md`
- Declares: responsibility, data ownership, capabilities, dependencies
- Agents use this for **task routing** — deciding which module to modify or request changes from

**Message Protocol** — File-based async communication:
- Request files in `.accord/comms/inbox/{target}/` with YAML frontmatter
- State machine: pending → approved → in-progress → completed
- Archive completed/rejected requests to `.accord/comms/archive/`

**Contract Scanner** — Auto-generate contracts from source code:
- Agent-agnostic instructions that any AI agent can follow
- Supports Java/Spring, Python/FastAPI, TypeScript/Express, Go
- Generated contracts start as `draft` — human review required before `stable`

## Repository Models

### Monorepo

All services in one repo. Simplest setup — comms are local, no push required.

### Multi-Repo (Hub-and-Spoke)

Each service has its own repo. A shared **Accord Hub** repo centralizes contracts and cross-service communication.

```
                    ┌─────────────────────┐
                    │     Accord Hub      │
                    │ contracts/ + comms/  │
                    └───┬─────┬──────┬────┘
                        │     │      │
               sync push/pull │ sync push/pull
                        │     │      │
              ┌─────────▼┐  ┌─▼──────▼──┐  ┌──────────┐
              │ device-  │  │ nac-      │  │ nac-     │
              │ manager  │  │ engine    │  │ admin    │
              └──────────┘  └───────────┘  └──────────┘
```

**Hub write rules**: Local `.accord/` is the write target. `.accord/hub/` is a read-only clone used for exchange — agents never edit it directly. `accord-sync.sh push` copies local → hub, `accord-sync.sh pull` copies hub → local.

**Push retry**: If a push to hub conflicts with a concurrent change from another service, `accord-sync.sh` automatically retries with rebase (up to 3 attempts).

**Template protection**: Template contracts (from init) are not pushed to hub. Real contracts from hub are not overwritten by templates.

## Sync Modes

Accord supports three modes for checking incoming requests:

| Mode | How it works | Best for |
|------|-------------|----------|
| `on-action` | Agent auto-checks inbox before/after operations | Most projects (default) |
| `auto-poll` | Background script polls every 5 minutes | Long-running sessions |
| `manual` | User explicitly runs `/accord-check-inbox` | Full control |

Set during init: `~/.accord/init.sh --sync-mode auto-poll`

## Agent Behaviors

Adapters inject these behaviors into the agent's instruction set:

| Behavior | Trigger | What happens |
|----------|---------|-------------|
| ON_START | Session begins | Read config, sync from hub, check inbox, announce module |
| ON_ROUTE | Task involves other modules | Read registry, check contracts, decide caller vs provider |
| ON_NEED_INTERFACE | Need API from another module | Create request file, commit, sync to hub |
| ON_APPROVED_REQUEST | Approved request in inbox | Present to user, implement, update contract |
| ON_COMPLETE | Request fulfilled | Verify contract, archive request, sync to hub |
| ON_DISPATCH | Multi-module feature | Break into per-module tasks, spawn subagents |
| ON_SCAN | Contract generation | Analyze source code, generate draft contracts |
| ON_CONFLICT | Merge conflict on contract | Notify user, show both versions |
| ON_LOG | Every action (if debug enabled) | Write JSONL log entry |

## Supported Agents

| Agent         | Adapter    | Status       |
|--------------|------------|--------------|
| Claude Code  | Full       | Available  |
| Generic      | Basic      | Available  |
| Cursor       | Planned    | Coming    |
| GitHub Copilot | Planned  | Coming    |
| OpenAI Codex | Planned    | Coming    |

The **generic adapter** works with any agent that can read a markdown instruction file.

## Init Options

```bash
~/.accord/init.sh [options]

--project-name <name>    Override auto-detected project name
--services <csv>         Override auto-detected service names
--service <name>         Service with sub-modules (auto-detects modules)
--modules <csv>          Explicit module names
--adapter <name>         claude-code | cursor | codex | generic | none
--repo-model <model>     monorepo | multi-repo (default: monorepo)
--hub <git-url>          Hub repo URL (multi-repo only)
--language <lang>        java | python | typescript | go (default: java)
--sync-mode <mode>       on-action | auto-poll | manual (default: on-action)
--scan                   Auto-scan source code for contracts after init
--force                  Re-initialize even if .accord/config.yaml exists
--no-interactive         Use auto-detected defaults without prompts
```

Init auto-detects: project name, language, adapter, services (from subdirectories), and modules (from service subdirectories). Re-running init without `--force` safely exits with no changes.

## Project Structure (after init)

```
your-project/
├── .accord/
│   ├── config.yaml                        # Project configuration
│   ├── contracts/                         # External Contract Registry
│   │   ├── frontend.yaml                  # OpenAPI spec per service
│   │   ├── nac-engine.yaml
│   │   ├── device-manager.yaml
│   │   └── internal/                      # Internal Contract Registry
│   │       ├── plugin.md                  # Code-level interface contract
│   │       └── discovery.md
│   ├── registry/                          # Module Registry
│   │   ├── frontend.md                    # Ownership, capabilities, dependencies
│   │   ├── nac-engine.md
│   │   └── device-manager.md
│   ├── comms/                             # Communication Layer
│   │   ├── inbox/
│   │   │   ├── frontend/                  # Service-level inboxes
│   │   │   ├── nac-engine/
│   │   │   ├── device-manager/
│   │   │   ├── plugin/                    # Module-level inboxes
│   │   │   └── discovery/
│   │   ├── archive/
│   │   ├── PROTOCOL.md
│   │   └── TEMPLATE.md
│   └── log/                               # Debug logs (gitignored)
│       └── *.jsonl
│
├── device-manager/                        # Service with sub-modules
│   ├── plugin/
│   └── discovery/
└── ... (your source code)
```

## Documentation

| Document | Description |
|----------|-------------|
| [Protocol Specification](PROTOCOL.md) | Core protocol: state machine, formats, rules, module registry |
| [Standard Interface](INTERFACE.md) | Required agent capabilities and behaviors (ON_START, ON_ROUTE, etc.) |
| [Registry Format](protocol/registry-format.md) | Module registry format and usage |
| [Scan Instructions](protocol/scan/SCAN_INSTRUCTIONS.md) | How contract scanning works |
| [Design Document](docs/DESIGN.md) | Architecture rationale and design decisions |
| [Session Context](docs/SESSION_CONTEXT.md) | WHY behind each design decision |

## Contributing

Contributions welcome, especially:

- **New adapters** for additional AI coding agents
- **Protocol improvements** based on real-world usage
- **Examples** showing Accord in different project types

## License

MIT
