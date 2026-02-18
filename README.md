# Accord Lite

Architecture-aware task execution for AI coding agents.

Accord Lite gives Claude Code (or any AI coding agent) a structured understanding of your codebase — module boundaries, dependency graphs, public APIs, and shared resources — so it can plan and execute multi-module tasks in the correct order.

## How It Works

1. **Scan** (`/accord-scan full`) — Analyzes your codebase and builds a knowledge base:
   - `module-map.yaml` — module definitions + dependency graph
   - `contracts/<module>.md` — per-module boundary contracts (public APIs, dependencies)
   - `ARCHITECTURE.md` — one-page architecture overview

2. **Plan** (`/accord-plan <task>`) — For multi-module tasks, creates a dependency-ordered execution plan

3. **Execute** (`/accord-execute`) — Carries out the plan step by step, updating contracts as APIs change

## Quick Start

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/aiwatching/accord/accord-lite/install.sh | bash

# Initialize your project
cd your-project
~/.accord/init.sh

# In Claude Code:
/accord-scan full        # Build knowledge base
/accord-plan <task>      # Plan a multi-module task
/accord-execute          # Execute next step
/accord-status           # Check progress
```

## What Gets Installed

```
your-project/
├── CLAUDE.md                          # Appended with Accord Lite rules
├── .claude/
│   ├── commands/                      # 5 slash commands
│   │   ├── accord-scan.md
│   │   ├── accord-plan.md
│   │   ├── accord-execute.md
│   │   ├── accord-status.md
│   │   └── accord-replan.md
│   └── skills/                        # 2 skills (scan + architect)
│       ├── accord-scan/SKILL.md
│       └── accord-architect/SKILL.md
└── .accord/
    ├── module-map.yaml                # Module knowledge base
    ├── ARCHITECTURE.md                # Architecture overview
    ├── contracts/                     # Per-module contracts
    └── plans/                         # Execution plans
        └── archive/                   # Completed plans
```

## Commands

| Command | Description |
|---------|-------------|
| `/accord-scan [mode]` | Build or update the knowledge base. Modes: `full`, `module <name>`, `diff`, `refresh` |
| `/accord-plan <task>` | Create a dependency-ordered execution plan for a multi-module task |
| `/accord-execute [all]` | Execute the next plan step (or all remaining steps) |
| `/accord-status` | Show current plan progress |
| `/accord-replan` | Revise remaining plan steps based on current state |

## Philosophy

- **Single agent, structured knowledge** — No multi-agent orchestration. One agent with a good map beats many agents guessing.
- **Contracts as boundaries** — Each module's public API is documented. Changes require contract updates first.
- **Dependency-aware execution** — Libraries first, then consumers. Never break the dependency chain.
- **Git-native** — Everything is files in your repo. No databases, no servers, no external services.
- **Agent-agnostic core** — The knowledge base (YAML + Markdown) works with any agent that can read files. Skills are Claude Code-specific but the data format is universal.

## License

Apache 2.0 — see [LICENSE](LICENSE)
