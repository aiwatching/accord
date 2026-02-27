# Accord

Module-level memory for Claude Code. Gives your AI coding agent persistent, per-module knowledge that survives across sessions.

## Install

```bash
mkdir -p .claude/skills/accord && curl -fsSL https://raw.githubusercontent.com/phodal/accord/main/SKILL.md -o .claude/skills/accord/SKILL.md
```

## Usage

### 1. Initialize

Start Claude Code in your project, then:

```
> initialize accord
```

This creates a root `.accord/` to track the entire project as one module.

For multi-module projects, declare sub-modules explicitly:

```
> initialize accord with modules: services/api, services/web, libs/shared
```

### 2. Scan a Module

After initialization, module.md are empty skeletons. Tell Claude to read the code and fill them in — one module at a time:

```
> scan root module
> scan module services/api
```

Or scan everything at once (only when you want to):

```
> scan all modules
```

### 3. Work Normally

Just use Claude Code as usual. Accord works automatically in the background:

- **Session start** — Claude reads all module.md, memory.md, and recent history. Outputs a project overview.
- **After each task** — Claude appends a one-line entry to today's `history/YYYY-MM-DD.md` in affected modules.
- **As it reads code** — Claude passively refines module.md and memory.md with new insights.

### 4. Manage Sub-Modules

Add or remove sub-modules at any time:

```
> add accord module services/payment
> remove accord module services/legacy
```

### 5. Rebuild Memory

If memory.md gets stale or corrupted, Claude can rebuild it from history:

```
> rebuild memory
```

## What Gets Created

**Single-module project** (default):

```
project/
├── .accord/
│   ├── module.md          # What this module is (<150 words)
│   ├── memory.md          # Accumulated insights (<300 words)
│   └── history/
│       ├── 2026-02-25.md  # Daily change log
│       └── 2026-02-27.md
├── src/
└── .claude/skills/accord/SKILL.md
```

**Multi-module project** (user-declared sub-modules):

```
project/
├── .accord/                    # Root — tracks everything not in a sub-module
│   ├── module.md
│   ├── memory.md
│   └── history/
├── services/api/
│   └── .accord/                # Sub-module
│       ├── module.md
│       ├── memory.md
│       └── history/
├── services/web/
│   └── .accord/
│       ├── module.md
│       ├── memory.md
│       └── history/
└── .claude/skills/accord/SKILL.md
```

## Three Knowledge Layers

| Layer | Purpose | Limit | Mutability |
|-------|---------|-------|------------|
| `module.md` | What the module is | <150 words | Refined over time |
| `memory.md` | Accumulated insights | <300 words | Rebuildable from history |
| `history/` | Daily change log | 30 days | Append-only per day |

## How Change Tracking Works

When Claude finishes a task:

1. Identifies which files changed
2. Maps each file to a module (sub-module if inside one, otherwise root)
3. Appends a one-liner to that module's `history/YYYY-MM-DD.md`
4. Updates `memory.md` if the change revealed a new insight
5. Prunes history files older than 30 days

Example `history/2026-02-27.md`:

```markdown
# 2026-02-27
- Added retry logic to HTTP client with exponential backoff
- Fixed race condition in connection pool cleanup
```

Example `memory.md`:

```markdown
# services/api — Memory

Uses exponential backoff for all external HTTP calls (added 2026-02-27).
Connection pool has a cleanup goroutine — watch for race conditions on shutdown.
Communicates with services/web via REST, with libs/shared for common types.
Config loaded from environment variables, see .env.example.
```

## License

Apache 2.0
