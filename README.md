# Accord

**Automated multi-agent orchestration framework built on Git.**

Accord coordinates multiple AI coding agents across services and sessions — automatically decomposing tasks, dispatching to the right agents, and streaming execution in real time. All state is plain files in Git. No databases, no message queues, no infrastructure to deploy.

---

## The Problem

AI coding agents work great within a single session. But real projects have multiple services, multiple modules, and multiple agents. When you need coordinated changes across services:

- You manually copy-paste context between agent sessions
- You lose track of which agent is doing what
- There's no way to see the full execution flow across agents

Accord solves this by providing a hub that automatically orchestrates multiple agents through a file-based protocol on Git.

## How It Works

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Accord Hub Service                            │
│                                                                      │
│   ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌───────────────┐  │
│   │ Console  │  │  Analytics   │  │ Session  │  │  Dispatcher   │  │
│   │ (chat)   │  │  (tokens)    │  │  Output  │  │  (workers)    │  │
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
│        │ service-a │   │ service-b│   │ service-c│                  │
│        │ (agent)   │   │ (agent)  │   │ (agent)  │                  │
│        └──────────┘   └──────────┘   └──────────┘                   │
└──────────────────────────────────────────────────────────────────────┘
```

1. You type a high-level directive in the Console (or submit a directive file)
2. The **orchestrator agent** decomposes it into per-service requests
3. The **scheduler** picks up pending requests and dispatches to **workers**
4. Each worker invokes an AI agent (via Claude Agent SDK or shell) against the target service
5. All tool calls, results, and output stream to the Console in real time
6. Token usage, cost, and performance are tracked in the Analytics dashboard

## Key Features

- **Automated multi-agent orchestration**: Scheduler + Dispatcher + Worker Pool automatically process requests — no manual intervention
- **Real-time execution visibility**: Console shows every tool call, file read/write, bash command, and result as agents work (structured stream events from the SDK)
- **Token & cost analytics**: Per-request, per-service, per-model, and per-day breakdowns of token usage and cost
- **Execution planner**: Optional plan generation + human review before the orchestrator executes (configurable model, e.g. haiku for planning)
- **Agent-agnostic protocol**: Works with Claude Code, Cursor, Codex, or any agent that can read/write files and run git
- **Two-level contracts**: External (OpenAPI) for service APIs + internal (code-level interfaces) for module boundaries
- **Module registry**: Each service declares ownership, capabilities, and dependencies — used for automated task routing
- **Fractal protocol**: Same state machine (`pending → in-progress → completed`) at every level
- **Monorepo and multi-repo**: Hub-and-Spoke model for multi-repo, flat `.accord/` for monorepo
- **Session continuity**: Chat with the orchestrator across multiple messages — session persists
- **Full traceability**: Every request, status change, and cost tracked in JSONL history

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

Open `http://localhost:3000` — two tabs:

- **Console**: Chat with the orchestrator, see real-time agent execution (tool calls, file edits, command output), service status badges, request lifecycle events
- **Analytics**: Token usage breakdown (input/output/cache), cost per service/model/day, request history with per-model detail

## Architecture

### Three-Tier Model

```
User          →  "Add device search to frontend"
                         │
Orchestrator  →  Decomposes into per-service requests
                         │
                ┌────────┼────────┐
Services      → service-a  service-b  service-c
                (agent)    (agent)    (agent)
```

- **User** provides high-level directives
- **Orchestrator** (agent on hub repo) decomposes, dispatches, routes, monitors
- **Services** execute work autonomously — each gets its own agent invocation

The orchestrator does NOT write application code. It only manages protocol files (requests, directives, status transitions). The actual coding happens in service agents.

### Hub Directory Structure

**Monorepo** (single repo with `.accord/`):

```
project/
├── .accord/
│   ├── config.yaml                 # Services, dispatcher settings
│   ├── contracts/
│   │   ├── {service}.yaml          # OpenAPI contracts
│   │   └── internal/{module}.md    # Code-level contracts
│   ├── registry/{service}.yaml     # Ownership, capabilities
│   ├── directives/                 # High-level requirements
│   └── comms/
│       ├── inbox/{service}/        # Pending requests
│       ├── archive/                # Completed requests
│       ├── history/                # JSONL audit log
│       └── sessions/              # Agent session logs
├── service-a/
├── service-b/
└── ...
```

**Multi-repo** (separate hub repo):

```
accord_hub/
├── accord.yaml                     # Org config (lists teams)
├── CLAUDE.md                       # Orchestrator instructions
└── teams/{team}/
    ├── config.yaml                 # Services, dispatcher settings
    ├── contracts/                  # Contracts
    ├── registry/                   # Service registries
    ├── directives/                 # High-level requirements
    └── comms/                      # Inboxes, archive, history
```

### Hub Service

The Hub Service (`agent/`) provides:

| Component | Description |
|-----------|-------------|
| **REST API** | `/api/requests`, `/api/services`, `/api/hub/analytics`, `/api/session/send` |
| **WebSocket** | Real-time streaming at `/ws` — structured tool calls, results, request events |
| **Scheduler** | Polls inboxes, dispatches to worker pool |
| **Dispatcher** | Assigns requests to workers with service affinity and directory constraints |
| **Worker Pool** | Concurrent agent invocations via Claude Agent SDK or shell command |
| **Planner** | Optional plan generation before orchestrator execution (approve/edit/cancel) |
| **Web UI** | Console (chat + execution stream) and Analytics (token/cost dashboard) |

### Automated Orchestration Flow

```
Scheduler polls inboxes (configurable interval)
  → finds pending requests
  → Dispatcher assigns to idle workers (respects directory constraints)
    → Worker claims request (status: in-progress, git commit)
    → Command fast-path: shell execution, no AI needed
    → Agent path: builds prompt with registry/contract context
      → Invokes AI agent (Claude SDK or shell)
      → Streams structured events (text, tool_use, tool_result, thinking)
      → On success: archives request, writes history, git commit
      → On failure: retries up to max_attempts, then escalates to orchestrator
```

## CLI Reference

```bash
accord-hub [options]

Options:
  --hub-dir <path>      Hub/project directory (default: current directory)
  --port <number>       HTTP port (default: 3000)
  --workers <N>         Concurrent workers (default: 4)
  --interval <seconds>  Scheduler polling interval (default: 30)
  --timeout <seconds>   Per-request timeout (default: 600)
  --agent-cmd <cmd>     Shell command to use as agent (instead of Claude SDK)
  --rebuild             Force rebuild before starting
  --help                Show help
```

Port can also be set in `config.yaml`:

```yaml
dispatcher:
  port: 8080
  workers: 4
  poll_interval: 30
  planner_enabled: true
  planner_model: claude-haiku-4-5-20251001
```

### Console Commands

Type these in the Web UI console:

| Command | Description |
|---------|-------------|
| `status` | Contract counts, inbox items, archived requests |
| `scan` | Validate all contracts |
| `check-inbox` | List pending inbox items |
| `validate` | Validate all request files |
| `sync` | Trigger immediate scheduler sync |
| `services` | List configured services |
| `requests` | List requests (use `requests --status pending` to filter) |
| `send <service> <msg>` | Create request in service inbox |
| `help` | Show all commands |

Typing a plain message with **orchestrator** selected sends it directly to the orchestrator agent session. With any other service selected, it creates a request file in that service's inbox.

## Supported Agents

| Agent         | Adapter    | Status       |
|--------------|------------|--------------|
| Claude Code  | Full (SDK) | Available  |
| Shell        | Generic    | Available  |
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
