# Accord

Module-level memory for Claude Code. Gives your AI coding agent persistent, per-module knowledge that survives across sessions.

## Install

```bash
mkdir -p .claude/skills/accord && curl -fsSL https://raw.githubusercontent.com/phodal/accord/main/SKILL.md -o .claude/skills/accord/SKILL.md
```

## Usage

```
> initialize accord
Accord initialized.
- root (.) — root module

> initialize accord with modules: services/api, services/web, libs/shared
Accord initialized.
- root (.) — root module
- services/api — sub-module
- services/web — sub-module
- libs/shared — sub-module
```

Sub-modules are **only** created when you explicitly declare them. No auto-scanning.

You can add or remove sub-modules later:
```
> add accord module services/payment
> remove accord module services/legacy
```

## What Gets Created

**Single-module project** (default):
```
project/
├── .accord/
│   ├── module.md          # What this module is (<150 words)
│   ├── memory.md          # Accumulated insights (<300 words)
│   └── history/
│       └── 2026-02-27.md  # Daily change log
└── .claude/skills/accord/SKILL.md
```

**Multi-module project** (user-declared sub-modules):
```
project/
├── .accord/                    # Root — tracks everything else
├── services/api/.accord/       # Sub-module
├── services/web/.accord/       # Sub-module
└── .claude/skills/accord/SKILL.md
```

## Three Knowledge Layers

| Layer | Purpose | Limit | Mutability |
|-------|---------|-------|------------|
| `module.md` | What the module is | <150 words | Refined over time |
| `memory.md` | Accumulated insights | <300 words | Rebuildable from history |
| `history/` | Daily change log | 30 days | Append-only per day |

## License

Apache 2.0
