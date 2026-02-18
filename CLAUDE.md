# Accord Lite — Tool Repository

## What This Repo Is

This is the **Accord Lite tool repository** — it provides `init.sh`, `install.sh`, skills, slash commands, and templates that users install into their own projects. This repo itself is NOT a project that uses Accord Lite.

## Repository Structure

```
accord/
├── README.md                    # Public-facing description
├── CLAUDE.md                    # This file — dev instructions for this repo
├── LICENSE                      # Apache 2.0
├── .gitignore
├── install.sh                   # Remote installer (curl | bash)
├── init.sh                      # Scaffold .accord/ in target project
├── test.sh                      # Integration tests
│
├── skills/                      # Skills copied to user projects
│   ├── accord-scan/SKILL.md
│   └── accord-architect/SKILL.md
│
├── commands/                    # Slash commands copied to user projects
│   ├── accord-scan.md
│   ├── accord-plan.md
│   ├── accord-execute.md
│   ├── accord-status.md
│   └── accord-replan.md
│
├── templates/                   # Templates used by init.sh + skills
│   ├── module-map.yaml.template
│   ├── contract.md.template
│   ├── plan.yaml.template
│   ├── architecture.md.template
│   └── claude-section.md.template
│
└── docs/
    ├── DESIGN.md                # Architecture & design decisions
    └── SESSION_CONTEXT.md       # Historical context
```

## Code Conventions

- Shell scripts target bash 4+ and should work on macOS and Linux
- `sed -i` differs macOS/Linux — use `sed expr file > tmp && mv tmp file`
- `set -e` + `[[ ]] && cmd` is lethal — always use `if [[ ... ]]; then ...; fi`
- Keep dependencies minimal — only Git and a text editor required
- Templates use `{{PLACEHOLDER}}` style variables
- YAML files follow the schemas defined in templates/

## Key Design Decisions

- **Single agent, not multi-agent**: one Claude Code session with architecture knowledge beats orchestrating many agents
- **Skills over code**: the intelligence lives in SKILL.md instructions, not in TypeScript/Python
- **File-based protocol**: module-map.yaml + contracts/*.md + plans/*.yaml — all readable, all in Git
- **Tool repo pattern**: this repo provides tools that get copied into user projects via init.sh

## Testing

```bash
bash test.sh    # Run all integration tests
```

## Reference

- See `docs/DESIGN.md` for the full design rationale
- See `docs/SESSION_CONTEXT.md` for historical context on design decisions
