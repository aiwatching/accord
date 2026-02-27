# Accord — Developer Guide

## What This Repo Is

This repo contains **one file that matters**: `SKILL.md` — a Claude Code skill that gives AI coding agents per-module memory.

Users copy `SKILL.md` into their project at `.claude/skills/accord/SKILL.md`.

## Repository Structure

```
accord/
├── SKILL.md        # The skill — only core file
├── README.md       # Install + usage instructions
├── CLAUDE.md       # This file
├── LICENSE         # Apache 2.0
└── .gitignore
```

## How the Skill Works

SKILL.md defines five behaviors:

- **ON_START** — loads module.md + memory.md + recent history at session boot
- **ON_INIT** — discovers modules via build files, scaffolds `.accord/` dirs
- **ON_CHANGE** — appends to daily `history/YYYY-MM-DD.md` + updates memory.md
- **ON_LEARN** — refines module.md and memory.md with new insights
- **ON_RECOVER** — rebuilds memory.md from history/ + module.md

Three knowledge layers per module:
- `module.md` — static description (<150 words)
- `memory.md` — accumulated insights (<300 words, rebuildable)
- `history/` — daily change logs (append-only, 30-day retention)

## Editing SKILL.md

- Keep instructions clear and imperative
- Each behavior section should be self-contained
- Test by copying to a sample project and running "initialize accord"
- Enforce size limits: module.md < 150 words, memory.md < 300 words
