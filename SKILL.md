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

### Step 1: Create Root `.accord/`

Always create `.accord/` at the project root first:

```
project-root/
├── .accord/
│   ├── module.md
│   ├── memory.md
│   └── history/
└── src/
```

### Step 2: Ask the User About Sub-Modules

**You must ask.** Do not scan for build files. Do not guess. Say:

```
Accord: root module created.
Does this project have sub-modules (e.g. microservices, packages)?
If yes, please list their paths (e.g. services/api, services/web, libs/shared).
If no, we're done — the root module will track everything.
```

- User says **no** (or just "initialize accord" with no further input) → done, root only.
- User lists paths → create `.accord/` in each specified directory:

```
project-root/
├── .accord/                    # Root module (always exists)
│   ├── module.md
│   ├── memory.md
│   └── history/
├── services/api/
│   └── .accord/                # Sub-module (user specified)
│       ├── module.md
│       ├── memory.md
│       └── history/
└── services/web/
    └── .accord/
        ├── module.md
        ├── memory.md
        └── history/
```

**Never auto-discover sub-modules.** The user decides what counts as a sub-module.

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

## ON_SCAN — Actively Scan Modules

Trigger: user says "scan modules", "scan accord", "update module descriptions", or "accord scan".

For each module (root + all sub-modules):

1. **Read key files** to understand the module:
   - Build file (package.json, pom.xml, go.mod, etc.) for dependencies and project type
   - Entry points (main.*, index.*, app.*, etc.)
   - README if it exists
   - Top-level source files for public APIs
   - Don't read everything — just enough to write a good summary
2. **Update `module.md`**:
   - **Purpose**: what this module does, in 1-2 sentences
   - **Key APIs**: main public interfaces, endpoints, exported functions
   - **Dependencies**: other modules/services it depends on
3. **Keep it under 150 words**
4. **Preserve human-written content** — if the user has edited module.md, refine around their text

User can also scan a single module:
- "scan accord module services/api" → only scan and update `services/api/.accord/module.md`

---

## ON_LEARN — Passive Learning

As you work (read code, fix bugs, implement features), you'll naturally learn things about modules. When you gain meaningful understanding:

1. **Update `module.md`** — refine Purpose, Key APIs, Dependencies
2. **Update `memory.md`** with deeper insights:
   - Design patterns used
   - Common pitfalls or gotchas
   - Important invariants ("X must always be called before Y")
   - Cross-module relationships
3. **Keep it concise** — module.md < 150 words, memory.md < 300 words
4. **Be factual** — only write what you've confirmed by reading code
5. **Don't force it** — only update when you genuinely learned something new

This is passive — it happens as a side effect of normal work, unlike ON_SCAN which is explicitly triggered.

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
