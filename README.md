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
┌──────────────────────────────────────────────────────────────────────┐
│                        Accord Hub Service                            │
│              Web UI + API + Scheduler + Worker Pool                   │
│                                                                      │
│   ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌───────────────┐  │
│   │ Console  │  │  Request     │  │ Session  │  │  Dispatcher   │  │
│   │ (chat)   │  │  Badges      │  │  Output  │  │  (workers)    │  │
│   └────┬─────┘  └──────┬───────┘  └────┬─────┘  └───────┬───────┘  │
│        │               │               │                │           │
│        └───────────────┴───────────────┴────────────────┘           │
│                              │                                       │
│                     ┌────────▼────────┐                              │
│                     │   Hub Directory  │                             │
│                     │  (protocol data) │                             │
│                     └────────┬────────┘                              │
│                              │                                       │
│              ┌───────────────┼───────────────┐                      │
│              │               │               │                      │
│        ┌─────▼────┐   ┌─────▼────┐   ┌──────▼───┐                  │
│        │ device-  │   │ web-     │   │ frontend │                   │
│        │ manager  │   │ server   │   │          │                   │
│        └──────────┘   └──────────┘   └──────────┘                   │
└──────────────────────────────────────────────────────────────────────┘
```

The Hub Service provides a single-page dashboard to interact with the orchestrator and all services. Type a message to the orchestrator — it decomposes your request, dispatches to the right services, and streams output in real time. All state is stored as plain files in the hub directory.

## Key Features

- **Hub Service**: Web UI + REST API + WebSocket streaming — one command to start
- **Agent-agnostic**: Works with Claude Code, Cursor, GitHub Copilot, Codex, or any agent that can read files and run git
- **Direct orchestrator session**: Chat with the orchestrator in real time via the console — maintains session continuity
- **Two-level contracts**: External contracts (OpenAPI) for service-level APIs + internal contracts (code-level interfaces) for module-level boundaries
- **Module registry**: Each module declares what it owns, what it can do, and what it depends on — agents use this for task routing
- **Fractal protocol**: Same state machine and workflow at every granularity level
- **Monorepo and multi-repo**: Hub-and-Spoke model for multi-repo
- **Auto-scan contracts**: Analyzes source code and generates contract files automatically
- **Session logs**: All agent output persisted to `comms/sessions/*.log` for review
- **Full traceability**: Every request, approval, and contract change tracked in JSONL history

## Quick Start

### Install

```bash
curl -fsSL https://raw.githubusercontent.com/aiwatching/accord/main/install.sh | bash
```

### Set up a project

```bash
# Interactive wizard — sets up hub + all services
~/.accord/setup.sh

# Or initialize a single repo
~/.accord/init.sh
```

### Start the Hub Service

```bash
accord-hub --hub-dir /path/to/hub --port 3000
```

Open `http://localhost:3000` — a single-page dashboard with:
- **Request badges**: pending/active counts per service
- **Session output**: real-time streaming from agent sessions
- **Console**: send messages to orchestrator or any service

### Update accord

```bash
accord-hub update
```

Pulls latest code, installs dependencies, rebuilds server + UI — one command.

## Architecture

### Three-Tier Model

```
User          →  "Add device search to frontend"
                         │
Orchestrator  →  Decomposes into per-service requests
                         │
                ┌────────┼────────┐
Services      → device-  web-     frontend
                manager  server
```

- **User** provides high-level directives
- **Orchestrator** (agent on hub repo) decomposes, dispatches, routes, monitors
- **Services** execute work autonomously (AI agent or human)

### Hub Directory Structure

The hub repo contains only protocol data — no application code:

```
accord_hub/
├── accord.yaml                     # Org config (lists teams)
├── CLAUDE.md                       # Orchestrator instructions
└── teams/{team}/
    ├── config.yaml                 # Services, dispatcher settings
    ├── contracts/
    │   ├── device-manager.yaml     # OpenAPI contracts
    │   ├── frontend.yaml
    │   └── web-server.yaml
    ├── registry/
    │   └── {service}.yaml          # Ownership, capabilities
    ├── directives/                 # High-level requirements
    └── comms/
        ├── inbox/{service}/        # Pending requests
        ├── archive/                # Completed requests
        ├── history/                # JSONL audit log
        └── sessions/              # Agent session logs
```

### Protocol Layer (agent-agnostic)

```
┌─────────────────────────────────────────────────────────┐
│                    Protocol Layer                        │
│                                                         │
│  ┌────────────┐ ┌───────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Contract   │ │  Message  │ │  Task    │ │ Module  │ │
│  │ Registry   │ │  Protocol │ │Lifecycle │ │Registry │ │
│  └────────────┘ └───────────┘ └──────────┘ └─────────┘ │
│                                                         │
│              All based on Git + Files                   │
└─────────────────────────────────────────────────────────┘
```

**Contract Registry** — Two levels:
- External: `.accord/contracts/{service}.yaml` (OpenAPI)
- Internal: `.accord/contracts/internal/{module}.md` (code-level interfaces)

**Message Protocol** — File-based async communication:
- Request files in `comms/inbox/{target}/` with YAML frontmatter
- State machine: `pending → approved → in-progress → completed`

**Module Registry** — Service/module ownership and capabilities at `registry/{name}.yaml`

### Hub Service

The Hub Service (`accord/agent/`) provides:

| Component | Description |
|-----------|-------------|
| **REST API** | `/api/requests`, `/api/services`, `/api/logs`, `/api/session/send` |
| **WebSocket** | Real-time streaming at `/ws` — session output, request events |
| **Scheduler** | Polls inboxes, dispatches to worker pool |
| **Dispatcher** | Assigns requests to workers with session affinity |
| **Worker Pool** | Concurrent agent invocations via Claude Agent SDK or shell |
| **Web UI** | Single-page dashboard — badges, output stream, console |

The Hub Service reads from and writes to the hub directory. It does **not** live inside the hub repo — it's installed separately and pointed at the hub via `--hub-dir`.

## CLI Reference

### accord-hub

```bash
accord-hub [command] [options]

Commands:
  update                Pull latest code, install deps, rebuild

Options:
  --hub-dir <path>      Hub directory (required)
  --port <number>       HTTP port (default: 3000, or from config)
  --workers <N>         Concurrent workers (default: 4)
  --interval <seconds>  Polling interval (default: 30)
  --timeout <seconds>   Per-request timeout (default: 600)
  --agent-cmd <cmd>     Shell agent command (instead of Claude SDK)
  --rebuild             Force rebuild before starting
```

Port can also be set in `config.yaml`:

```yaml
dispatcher:
  port: 8080
  workers: 4
```

### Console Commands

Type these in the Web UI console:

| Command | Description |
|---------|-------------|
| `status` | Contract counts, inbox items, archived requests |
| `scan` | Validate all contracts |
| `check-inbox` | List pending inbox items |
| `services` | List configured services |
| `requests` | List requests (use `requests --status pending` to filter) |
| `send <service> <msg>` | Create request in service inbox |
| `help` | Show all commands |

Typing a plain message with **orchestrator** selected sends it directly to the orchestrator agent session. With any other service selected, it creates a request file.

## Supported Agents

| Agent         | Adapter    | Status       |
|--------------|------------|--------------|
| Claude Code  | Full       | Available  |
| Generic      | Basic      | Available  |
| Cursor       | Planned    | Coming    |
| GitHub Copilot | Planned  | Coming    |
| OpenAI Codex | Planned    | Coming    |

## Documentation

| Document | Description |
|----------|-------------|
| [Install Guide](docs/INSTALL.md) | Hub-centric setup guide |
| [Commands Reference](docs/COMMANDS.md) | All slash commands and CLI tools |
| [v2 Architecture](docs/DESIGN-V2.md) | Orchestrator, directives, routing, audit trail |
| [Contract Types Roadmap](docs/CONTRACT-TYPES-ROADMAP.md) | Expansion plan: DB schema, AsyncAPI, gRPC |
| [Protocol Specification](docs/PROTOCOL.md) | Core protocol: state machine, formats, rules |
| [Session Context](docs/SESSION_CONTEXT.md) | WHY behind each design decision |

## Contributing

Contributions welcome, especially:

- **New adapters** for additional AI coding agents
- **Protocol improvements** based on real-world usage
- **Examples** showing Accord in different project types

## License

MIT
