# Accord - Agent-Agnostic Collaboration Framework

## Project Overview
Accord is a Git-based, agent-agnostic framework for coordinating multiple AI coding agents across services, modules, and sessions in large-scale software projects.

Core problem: AI coding agents (Claude Code, Cursor, Copilot, etc.) work well within a single session, but there's no standard way for multiple agent sessions to collaborate asynchronously — especially across services, modules, or time.

Accord solves this with a file-based protocol layered on Git, so any agent that can read/write files and run git commands can participate.

## Architecture: Two Layers

### Protocol Layer (agent-agnostic)
- Contract Registry: Two levels — external contracts (OpenAPI) for inter-service APIs, internal contracts (code-level interfaces) for intra-service modules
- Message Protocol: request files in `.accord/comms/inbox/` for cross-service and cross-module communication
- Task Lifecycle: state machine governing request status transitions (same at both levels — fractal protocol)
- All based on Git + files. No external dependencies.

### Adapter Layer (agent-specific)
- Translates the protocol into agent-specific instruction formats
- Claude Code adapter: CLAUDE.md + slash commands
- Cursor adapter: .cursorrules
- Codex adapter: AGENTS.md
- Generic adapter: plain markdown any agent can read

## Key Design Decisions
- Git as the message bus: git pull = receive, git push = send. Zero infrastructure.
- Two-level contracts: OpenAPI for service-level APIs, code-level interfaces (Java/Python/TS) for module-level boundaries
- Fractal protocol: same state machine and message format at every granularity level
- Multi-repo support: Hub-and-Spoke model — shared Accord Hub repo for cross-service, service repos for internal modules
- Centralized contracts: all contracts live under `.accord/contracts/` (external) and `.accord/contracts/internal/` (internal) — single copy, no collection needed in monorepo
- File-based protocol: no databases, no message queues, no servers to deploy
- Agent-agnostic core: the protocol layer has zero dependency on any specific AI tool
- Adapters are thin: just template files that inject protocol rules into agent-specific config formats

## Tech Stack
- Protocol: Markdown + YAML + OpenAPI 3.x
- Init tooling: Shell script (bash) for project initialization
- Adapters: Template files (no code dependencies)
- Optional: Node.js/Python CLI for advanced operations (later phase)

## Development Priorities
1. PROTOCOL.md — complete the protocol specification (state machine, request format, contract rules, two-level contracts)
2. Templates — request.md.template, contract.yaml.template, internal-contract.md.template
3. Contract Scanner — `protocol/scan/` with SCAN_INSTRUCTIONS.md, scan.sh, validators
4. Init script — `accord init` to scaffold a project (including internal contract directories for services with modules)
5. Claude Code adapter — first adapter implementation (includes contract-scanner skill)
6. Generic adapter — fallback for any agent
7. Example project — a realistic multi-service example showing both external and internal contracts
8. Additional adapters — Cursor, Codex, etc.

## Directory Structure
```
accord/
├── CLAUDE.md                    # This file
├── README.md                    # Public-facing project description
├── PROTOCOL.md                  # Core protocol specification
├── INTERFACE.md                 # Agent capability requirements
├── docs/
│   ├── DESIGN.md                # Full design document (architecture rationale)
│   └── SESSION_CONTEXT.md       # Design session context (WHY behind decisions)
├── protocol/
│   ├── state-machine.md         # Request state transitions
│   ├── request-format.md        # Request file specification
│   ├── contract-rules.md        # Contract management rules
│   ├── templates/
│   │   ├── request.md.template           # Template for cross-boundary requests
│   │   ├── contract.yaml.template        # Template for external OpenAPI contracts
│   │   └── internal-contract.md.template # Template for internal code-level contracts
│   └── scan/                    # Contract Scanner (agent-agnostic)
│       ├── SCAN_INSTRUCTIONS.md # Scanning rules and output format
│       ├── scan.sh              # Entry point script (prompt generator + validator)
│       └── validators/          # Output format validators
│           ├── validate-openapi.sh
│           └── validate-internal.sh
├── adapters/
│   ├── claude-code/
│   │   ├── CLAUDE.md.template
│   │   ├── commands/
│   │   │   ├── accord-check-inbox.md
│   │   │   ├── accord-send-request.md
│   │   │   ├── accord-complete-request.md
│   │   │   └── accord-scan.md
│   │   ├── skills/
│   │   │   └── contract-scanner/
│   │   │       └── SKILL.md    # Contract scanner skill for Claude Code
│   │   └── install.sh
│   ├── cursor/
│   │   ├── .cursorrules.template
│   │   └── install.sh
│   ├── codex/
│   │   ├── AGENTS.md.template
│   │   └── install.sh
│   └── generic/
│       └── AGENT_INSTRUCTIONS.md
├── init.sh                      # Project initialization script
└── examples/
    └── microservice-project/    # Complete usage example (external + internal contracts)
```

## Code Conventions
- All protocol documents use Markdown with YAML frontmatter where structured data is needed
- OpenAPI specs follow OpenAPI 3.0+ standard
- Shell scripts target bash 4+ and should work on macOS and Linux
- Keep dependencies minimal — the core framework should require only Git and a text editor
- Use clear, descriptive commit messages: `protocol: ...`, `adapter(claude-code): ...`, `docs: ...`

## Reference Documents
- See `docs/DESIGN.md` for the full architectural design and rationale
- See `docs/SESSION_CONTEXT.md` for the complete design session context — WHY each decision was made, what alternatives were considered, and the developer's original use case
- See `PROTOCOL.md` for the core protocol specification
- See `INTERFACE.md` for agent capability requirements
