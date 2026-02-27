# Accord — Module Memory for Claude Code

You are an AI coding agent with **module-level memory**. This skill gives you persistent, per-module knowledge that survives across sessions.

Each module has three knowledge layers:
- **module.md** — what this module is (static description)
- **memory.md** — what you know about it (accumulated insights, can be rebuilt from history)
- **history/** — what happened, day by day (immutable log)

---

## ON_START — Session Boot

Run this automatically at the start of every conversation.

1. Find all `.accord/module.md` files in the project:
   - Check project root for `.accord/module.md`
   - Search subdirectories (depth 1-3) for `.accord/module.md`
   - Skip `node_modules`, `.git`, `vendor`, `target`, `build`, `dist`
2. Read each `module.md` (they are short, <150 words each)
3. Read each `memory.md` (if it exists — accumulated insights)
4. Read today's and yesterday's `history/YYYY-MM-DD.md` (if they exist)
5. Output a brief overview:
   ```
   Accord: N modules loaded.
   - root (.): short description
   - service-a (services/a): short description
   Recent:
   - [2026-02-27] root: did X
   - [2026-02-26] service-a: did Y
   ```

If no `.accord/module.md` files are found, say:
```
Accord: No modules found. Say "initialize accord" to set up module tracking.
```

---

## ON_INIT — Initialize Module Tracking

Trigger: user says "initialize accord", "init accord", "setup accord", or this is the first time and no modules exist.

### Default: Single-Module Project

If the user does not specify sub-modules, create `.accord/` at the project root only:

```
project-root/
├── .accord/
│   ├── module.md
│   ├── memory.md
│   └── history/
└── src/
```

All changes across the entire project are tracked by this single root module.

### With Sub-Modules: User Must Specify

Sub-modules are **only** created when the user explicitly declares them. Examples:

- "initialize accord with modules: services/api, services/web, libs/shared"
- "init accord, sub-modules are frontend and backend"
- "add accord module services/payment"

For each declared sub-module, create `.accord/` inside that directory:

```
project-root/
├── .accord/                    # Root module (always exists)
│   ├── module.md
│   ├── memory.md
│   └── history/
├── services/api/
│   └── .accord/                # Sub-module (user declared)
│       ├── module.md
│       ├── memory.md
│       └── history/
└── services/web/
    └── .accord/
        ├── module.md
        ├── memory.md
        └── history/
```

**Never auto-discover sub-modules.** Don't scan for build files to guess module boundaries. The user knows their project structure.

### Adding / Removing Sub-Modules Later

- "add accord module services/payment" → create `.accord/` in `services/payment/`
- "remove accord module services/legacy" → delete `services/legacy/.accord/`

### Scaffold Files

**module.md** template:
```markdown
# <module-name>

**Path:** <relative-path, or `.` for root>

## Purpose
<To be filled — what does this module do?>

## Key APIs
<To be filled — main public interfaces>

## Dependencies
<To be filled — what other modules/services does this depend on?>
```

**memory.md** template:
```markdown
# <module-name> — Memory

<!-- Accumulated knowledge. Can be rebuilt from history/ + module.md -->
```

**history/** — create as empty directory.

### Report Results

```
Accord initialized.
- root (.) — root module
- services/api (services/api) — sub-module
- services/web (services/web) — sub-module
```

---

## ON_CHANGE — After Completing a Task

After you finish making changes to the codebase (bug fix, feature, refactor, etc.):

1. **Identify which module each changed file belongs to:**
   - If the file is inside a declared sub-module directory → that sub-module
   - Otherwise → root module

2. **Append to today's history file** — `history/YYYY-MM-DD.md` in each affected module:
   - Create the file if it doesn't exist yet (with `# YYYY-MM-DD` header)
   - Append one line: `- <description of what changed, max 80 chars>`
   - Be specific: "Added retry logic to HTTP client" not "Updated code"

3. **Update `memory.md`** if the change revealed something worth remembering:
   - Patterns: "Uses event sourcing for state changes"
   - Gotchas: "Changing X requires updating config Y"
   - Architecture: "Communicates with service-b via gRPC"
   - Don't repeat the history entry — memory is insights, not a log
   - Keep memory.md under 300 words

4. **Clean up old history** — if `history/` has more than 30 files, delete the oldest ones

---

## ON_LEARN — When You Understand a Module Better

As you read code, fix bugs, or implement features, you'll learn things about modules. When you gain meaningful understanding:

1. **Update `module.md`** with what you learned:
   - **Purpose**: what the module does in the system
   - **Key APIs**: main public interfaces, endpoints, exported functions
   - **Dependencies**: other modules it calls, external services, databases
2. **Update `memory.md`** with deeper insights:
   - Design patterns used
   - Common pitfalls or gotchas
   - Important invariants ("X must always be called before Y")
   - Cross-module relationships
3. **Keep it concise** — module.md < 150 words, memory.md < 300 words
4. **Be factual** — only write what you've confirmed by reading code
5. **Don't force it** — only update when you genuinely learned something new

---

## ON_RECOVER — Rebuild Memory

Trigger: user says "rebuild memory", "recover accord memory", or memory.md appears corrupted/empty.

1. Read the module's `module.md` for basic info
2. Read all files in `history/` (chronological order)
3. Synthesize a new `memory.md`:
   - Extract recurring patterns from history
   - Identify architectural insights
   - Note any gotchas or important decisions
4. Keep the result under 300 words

---

## Rules

- **Never auto-discover sub-modules** — only create them when the user explicitly declares
- **Root `.accord/` always exists** — it tracks everything not covered by a sub-module
- **Never delete or overwrite** human-written content in module.md — only add/refine
- **module.md is a description** — what the module is (<150 words)
- **memory.md is accumulated knowledge** — insights and patterns (<300 words)
- **history/ is an immutable log** — one file per day, append-only within a day
- **Don't block on errors** — if a module's .accord/ is missing or unwritable, skip it
- **Language-agnostic** — works with any language, framework, or project structure
