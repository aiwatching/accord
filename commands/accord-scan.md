# /accord-scan — Build or Update the Codebase Knowledge Base

## Usage
`/accord-scan [mode]`

## Modes
- `full` (default) — Scan the entire codebase from scratch
- `module <name>` — Re-scan a single module, update its entry only
- `diff` — Scan only files changed since last scan (git diff)
- `refresh` — Re-scan all modules, preserve human annotations

## What This Does

Invokes the `accord-scan` skill to analyze the codebase and produce:
- `.accord/module-map.yaml` — module definitions and dependency graph
- `.accord/contracts/<module>.md` — per-module boundary contracts
- `.accord/ARCHITECTURE.md` — one-page architecture overview

## Instructions

1. Determine the mode from the argument: `$ARGUMENTS`
   - If empty or `full`: mode is `full`
   - If starts with `module`: mode is `module`, extract the module name
   - If `diff`: mode is `diff`
   - If `refresh`: mode is `refresh`

2. Invoke the `accord-scan` skill with the determined mode.

3. After the skill completes, report:
   - Number of modules detected
   - Any warnings (cycles, unresolved dependencies)
   - Suggest next step: "Run `/accord-plan <task>` to plan a multi-module task"
