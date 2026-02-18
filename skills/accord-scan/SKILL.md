# Accord Scan — Codebase Knowledge Base Builder

You are the Accord Scan skill. Your job is to analyze a codebase and build a structured knowledge base that maps modules, dependencies, public APIs, and shared resources.

## Inputs

- **Mode** (from slash command argument):
  - `full` — scan the entire codebase from scratch
  - `module <name>` — re-scan a single module, update its entry only
  - `diff` — scan only files changed since last scan (use `git diff`)
  - `refresh` — re-scan all modules, but preserve human annotations (stability markers, change rules, manual notes)

## Outputs

You produce three artifacts in `.accord/`:

1. **`.accord/module-map.yaml`** — the central knowledge base
2. **`.accord/contracts/<module-name>.md`** — one contract file per module
3. **`.accord/ARCHITECTURE.md`** — one-page architecture overview

## Procedure

### Step 1: Detect Module Boundaries

Scan the project root for build/config files that indicate module boundaries:

| Build File | Ecosystem |
|-----------|-----------|
| `pom.xml` | Java/Maven (check for `<modules>` in parent pom) |
| `build.gradle` / `build.gradle.kts` | Java/Gradle (check `settings.gradle` for `include`) |
| `package.json` | Node.js (check for workspaces in root package.json) |
| `go.mod` | Go |
| `Cargo.toml` | Rust (check for `[workspace]` members) |
| `pyproject.toml` / `setup.py` | Python |
| `CMakeLists.txt` | C/C++ |
| `*.csproj` / `*.sln` | .NET |

For monorepos, the root build file often lists submodules. For polyrepos, each directory with its own build file is a module.

**Heuristics for module type:**
- Has REST controllers/routes/handlers → `service`
- Has `main()` or entry point but no HTTP → `service` (CLI/daemon)
- Exports types/interfaces but no entry point → `library`
- Is a subdirectory of a service, has its own package → `module`

### Step 2: Extract Public APIs

For each detected module, identify its public API surface:

**REST Endpoints:**
- Look for route/controller annotations: `@RestController`, `@RequestMapping`, `@GetMapping`, `@PostMapping` (Java Spring)
- Express/Fastify route registrations: `app.get()`, `app.post()`, `server.route()`
- Framework-specific patterns: Django `urlpatterns`, Flask `@app.route`, Go `http.HandleFunc`
- Extract: HTTP method, path, request/response types

**Interfaces / Exported Types:**
- Java: `public interface`, `public abstract class` in `src/main/java/**/api/` or similar
- TypeScript: `export interface`, `export type`, `export class` in barrel files (`index.ts`)
- Python: classes in `__init__.py`, Protocol classes, ABC subclasses
- Go: exported functions/types (capitalized names) in package-level files

**Shared Types:**
- Types referenced by multiple modules (DTOs, models, events)
- Look in shared/common directories

### Step 3: Detect Dependencies

Analyze each module for dependencies on other modules in the same project:

**Import Analysis:**
- Java: `import com.project.othermodule.*`
- TypeScript/JS: `import ... from '../other-module'` or `@project/other-module`
- Python: `from project.other_module import ...`
- Go: `import "project/other-module"`

**REST Client URLs:**
- HTTP client calls to other services: `fetch('/api/other-service/...')`, `RestTemplate`, `WebClient`
- Service discovery references: env vars like `OTHER_SERVICE_URL`

**Shared Resources:**
- Database tables: look for entity/model definitions, SQL migrations, ORM models
- Message topics: Kafka/RabbitMQ/SQS topic names in producer/consumer configs
- File paths: shared filesystem locations
- Cache keys: shared Redis/cache key patterns

### Step 4: Compute Build Order

Build a directed acyclic graph (DAG) from module dependencies:
1. Each module is a node
2. Each dependency is a directed edge (A depends_on B → edge from A to B)
3. Run topological sort to get build order
4. If cycles exist, note them as warnings in ARCHITECTURE.md

### Step 5: Write module-map.yaml

Write `.accord/module-map.yaml` with the following structure:

```yaml
version: "0.1"
scanned_at: "<ISO 8601 timestamp>"
project:
  name: "<detected project name>"
  root: "."

modules:
  <module-name>:
    path: "<relative path from project root>"
    type: service | library | module
    description: "<one-line description of what this module does>"
    public_api:
      rest:
        - method: GET|POST|PUT|DELETE|PATCH
          path: "/api/..."
          description: "<what it does>"
      interfaces:
        - name: "<interface/class name>"
          file: "<relative file path>"
          methods:
            - "<method signature>"
      types:
        - name: "<type name>"
          file: "<relative file path>"
    depends_on:
      - "<other module name>"
    depended_by:
      - "<other module name>"
    shared_resources:
      - type: database | message_topic | file | cache
        name: "<resource identifier>"
        access: read | write | read_write

build_order:
  - "<module with no deps first>"
  - "<modules with resolved deps next>"
  - "..."
```

### Step 6: Write Contract Files

For each module, write `.accord/contracts/<module-name>.md`:

```markdown
---
module: <module-name>
type: <service|library|module>
status: draft
last_scanned: "<ISO 8601 timestamp>"
---

## Purpose

<One paragraph describing what this module does and its role in the system.>

## Public API

### REST Endpoints
- `GET /api/...` — <description>
- `POST /api/...` — <description>

### Interfaces
- `InterfaceName` (path/to/file.ext)
  - `methodSignature()` — <description>

### Types
- `TypeName` (path/to/file.ext) — <description>

## Dependencies
- `other-module` — <why this dependency exists>

## Depended By
- `consumer-module` — <how it uses this module>

## Shared Resources
- DB table `table_name` (read_write) — <purpose>
- Topic `topic.name` (write) — <purpose>

## Change Rules

- Stability: draft
- Before modifying public API: update this contract, then update all dependents
```

### Step 7: Write ARCHITECTURE.md

Generate `.accord/ARCHITECTURE.md`:

```markdown
# Architecture — <Project Name>

> Auto-generated by `accord-scan`. Human annotations are preserved on re-scan.

## Modules

| Module | Type | Path | Dependencies |
|--------|------|------|-------------|
| module-a | service | services/module-a | module-b, shared-lib |
| module-b | service | services/module-b | shared-lib |
| shared-lib | library | libs/shared | (none) |

## Dependency Graph

shared-lib
├── module-a
└── module-b
    └── module-a

## Shared Resources

| Resource | Type | Used By |
|----------|------|---------|
| users table | database | module-a (rw), module-b (r) |

## Build Order

1. shared-lib
2. module-b
3. module-a
```

## Mode-Specific Behavior

### `full` mode
- Scan everything from scratch
- Overwrite all files (except human annotations if any exist — see `refresh`)

### `module <name>` mode
- Only scan the specified module's directory
- Update its entry in `module-map.yaml`
- Update its contract file
- Recalculate `depended_by` for all modules (the new module may now be a dependency)
- Regenerate `ARCHITECTURE.md`

### `diff` mode
- Run `git diff --name-only` against the `scanned_at` timestamp (or HEAD~1 if no timestamp)
- Identify which modules have changed files
- Re-scan only those modules
- Update their entries and contracts
- Regenerate `ARCHITECTURE.md`

### `refresh` mode
- Re-scan all modules like `full`
- But preserve human-authored content:
  - `status` field in contract frontmatter (if not `draft`)
  - "Change Rules" section content
  - Any `<!-- human: ... -->` annotated sections
  - `description` fields if already filled in

## Important Rules

1. **Be conservative with dependencies**: only record dependencies you can verify from code (imports, API calls, shared resources). Don't guess.
2. **Preserve human work**: never overwrite manually set `status: stable` or human-written descriptions on refresh.
3. **Note uncertainty**: if you're unsure about a dependency or API, add a `# TODO: verify` comment.
4. **Keep descriptions concise**: one line for module descriptions, one sentence for API descriptions.
5. **Relative paths only**: all paths in module-map.yaml and contracts must be relative to project root.
