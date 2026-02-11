# Accord v2 Architecture: Orchestrator & Centralized Routing

Version: 0.2.0-draft

> This document describes the v2 evolution of Accord. For the v1 foundation (two-layer design,
> fractal protocol, two-level contracts, hub-and-spoke model), see [`docs/DESIGN.md`](DESIGN.md)
> and [`PROTOCOL.md`](../PROTOCOL.md). Everything in v1 remains unchanged — v2 is purely additive.

---

## 1. Introduction

Accord v1 established a Git-based, agent-agnostic protocol for coordinating AI coding agents
across services and modules. Each service runs its own agent session, communicates through
file-based requests, and synchronizes via Git.

v2 adds an **orchestrator layer** on top of v1. The orchestrator is a dedicated agent session
running on the hub repo that decomposes high-level requirements into per-service requests,
routes inter-service communication centrally, and tracks feature-level progress across the
entire system.

The key principle: **v1 remains fully functional**. Services can still communicate directly.
The orchestrator is an additional, recommended coordination path that eliminates the need for
a human to manually decompose features and jump between sessions.

---

## 2. Motivation

v1 leaves five things manual:

| Gap | What happens in v1 |
|-----|-------------------|
| **No single view** | No entity sees the full picture across all services. The human holds the architecture in their head. |
| **Manual decomposition** | When a feature touches 3 services, the human must figure out which services need what, create requests manually in each inbox, and track progress across sessions. |
| **No feature tracking** | Requests are independent. There's no parent entity linking "add OAuth" → {frontend request, backend request, admin request}. |
| **Point-to-point routing** | Service A must know that Service B owns the data it needs. If it guesses wrong, the request goes to the wrong inbox. |
| **Manual completion tracking** | To know if a feature is done, the human must check archives across all services. |

v2 solves all five by introducing a single orchestrator that has full visibility, decomposes
requirements automatically, routes requests using registry knowledge, and tracks feature
completion through a new entity called a **directive**.

---

## 3. Three-Tier Architecture

```
                    ┌─────────────────────────┐
                    │         User             │
                    │  (high-level requirement)│
                    └────────────┬────────────┘
                                 │
                    writes directive to hub
                                 │
                    ┌────────────▼────────────┐
                    │      Orchestrator        │
                    │  (Claude Code on hub)    │
                    │                          │
                    │  - Reads all registries  │
                    │  - Reads all contracts   │
                    │  - Decomposes directives │
                    │  - Routes requests       │
                    │  - Tracks completion     │
                    └──┬──────────┬─────────┬──┘
                       │          │         │
            dispatches requests to service inboxes
                       │          │         │
            ┌──────────▼──┐ ┌────▼─────┐ ┌─▼──────────┐
            │  frontend   │ │demo-engine│ │device-mgr   │
            │  (agent or  │ │ (agent or│ │ (agent or   │
            │   human)    │ │  human)  │ │  human)     │
            └─────────────┘ └──────────┘ └─────────────┘
                  Each pulls from hub, works autonomously,
                  pushes results back to hub
```

**Three tiers:**

1. **User** — provides high-level requirements ("Add OAuth2 authentication")
2. **Orchestrator** — decomposes, dispatches, routes, and tracks (runs on hub repo)
3. **Service nodes** — execute work autonomously (each runs its own agent or human session)

The orchestrator does NOT execute code. It only reads registries/contracts, creates requests,
and monitors progress. All implementation happens in the service nodes.

---

## 4. Centralized Routing

### 4.1 v1: Point-to-Point

In v1, the requesting service must know who to send to:

```
device-manager ──request──► demo-engine inbox
```

This works when the requester knows the target. It fails when:
- The requester doesn't know who owns the data
- The request requires coordination across multiple services
- The request triggers cascading changes

### 4.2 v2: Two Routing Modes

v2 introduces an **orchestrator inbox** and supports two routing modes:

**Mode 1: Orchestrator-Initiated** (top-down)

The orchestrator decomposes a directive and dispatches requests:

```
User writes directive
        │
        ▼
Orchestrator reads registries + contracts
        │
        ├──► request → frontend inbox    (UI changes)
        ├──► request → demo-engine inbox  (policy changes)
        └──► request → device-manager inbox (device changes)
```

**Mode 2: Service-Escalated** (bottom-up)

A service sends a request to the orchestrator instead of guessing the target:

```
device-manager ──request──► orchestrator inbox
                                    │
                    Orchestrator reads registries
                    Determines: demo-engine owns policies
                                    │
                    Orchestrator ──request──► demo-engine inbox
                    (with attribution: originated from device-manager)
```

### 4.3 Comparison

| Aspect | v1 Point-to-Point | v2 Orchestrator-Initiated | v2 Service-Escalated |
|--------|-------------------|---------------------------|----------------------|
| Who routes? | Requesting service | Orchestrator | Orchestrator |
| Who decomposes? | Human | Orchestrator | N/A (single request) |
| Registry knowledge needed? | By each service | By orchestrator only | By orchestrator only |
| Feature tracking? | None | Via directive | Via directive (optional) |
| When to use | Service knows target | New features, multi-service work | Service unsure of target |

### 4.4 v1 Fallback

v1 direct routing is **not removed**. Services can still send requests directly to each
other's inboxes. The orchestrator routing is an additional path. This ensures:
- v1 projects work without modification
- Simple, known-target requests don't need orchestrator overhead
- Services can operate even if the orchestrator is not running

---

## 5. Directives

A **directive** is a new entity representing a high-level requirement that may span multiple
services. Directives live only on the hub — service repos never see them.

### 5.1 Format

Directives use Markdown with YAML frontmatter, consistent with request files:

```yaml
---
id: dir-001-add-oauth
title: Add OAuth2 Authentication
priority: high
status: pending
created: 2026-02-10T10:00:00Z
updated: 2026-02-10T10:00:00Z
requests: []
---

## Requirement

Add OAuth2 authentication with Google and GitHub providers. All API endpoints
must require authentication. The admin panel needs a login page. Device
registration endpoints need service-to-service auth via client credentials.

## Acceptance Criteria

- [ ] Frontend: login page with Google/GitHub OAuth buttons
- [ ] demo-engine: all /api/* endpoints require Bearer token
- [ ] demo-admin: OAuth provider configuration UI
- [ ] device-manager: client credentials flow for M2M auth

## Decomposition

| Request | Target | Status |
|---------|--------|--------|
| | | |
```

The `## Decomposition` table is populated by the orchestrator after analyzing the requirement.

### 5.2 Directive Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | `dir-{NNN}-{short-description}` |
| `title` | Yes | Human-readable title |
| `priority` | Yes | `low`, `medium`, `high`, `critical` |
| `status` | Yes | See lifecycle below |
| `created` | Yes | ISO 8601 timestamp |
| `updated` | Yes | Updated on each status change |
| `requests` | Yes | List of request IDs spawned from this directive |

### 5.3 Directive Lifecycle

```
┌─────────┐     Orchestrator decomposes     ┌──────────────┐
│ pending  │ ──────────────────────────────► │ in-progress  │
└─────────┘     and dispatches requests      └──────┬───────┘
                                                    │
                                       ┌────────────┴────────────┐
                                       ▼                         ▼
                              ┌─────────────┐          ┌──────────┐
                              │  completed   │          │  failed   │
                              └─────────────┘          └──────────┘
                           all requests completed    one or more rejected
                                                     or unresolvable
```

- **pending**: Directive written, not yet decomposed
- **in-progress**: Orchestrator has created requests, work is underway
- **completed**: All spawned requests are completed
- **failed**: One or more requests were rejected or cannot be fulfilled

The orchestrator monitors request statuses and updates the directive automatically.

---

## 6. Request Extension

v2 adds one optional field to the request frontmatter:

```yaml
directive: dir-001-add-oauth
```

This field is **backward-compatible** — v1 services that don't understand it simply ignore it.
The orchestrator uses it to link requests back to their parent directive for tracking.

**Extended request example:**

```yaml
---
id: req-101-oauth-endpoints
from: orchestrator
to: demo-engine
scope: external
type: api-addition
priority: high
status: pending
created: 2026-02-10T10:05:00Z
updated: 2026-02-10T10:05:00Z
related_contract: contracts/demo-engine.yaml
directive: dir-001-add-oauth
---

## What
Add OAuth2 Bearer token validation to all /api/* endpoints.

## Proposed Change
...
```

**Service-escalated request (to orchestrator):**

```yaml
---
id: req-201-need-policy-api
from: device-manager
to: orchestrator
scope: external
type: api-addition
priority: medium
status: pending
created: 2026-02-10T14:00:00Z
updated: 2026-02-10T14:00:00Z
---

## What
Need an API to query policies by device type. Not sure which service owns this.

## Why
After device discovery, need to look up the default policy for the device type.
```

The orchestrator receives this, consults the registry, determines demo-engine owns policies,
and creates a new request in `comms/inbox/demo-engine/` with proper attribution.

---

## 7. Hub Structure (v2)

The hub repo in v1 already uses a flat structure (no `.accord/` prefix). v2 adds minimal
new directories:

```
accord-hub/                              ← git repo root
├── CLAUDE.md                            ← Orchestrator instructions (NEW)
├── .claude/
│   └── commands/                        ← Orchestrator slash commands (NEW)
│       ├── decompose.md
│       ├── dispatch.md
│       ├── monitor.md
│       └── route.md
├── config.yaml                          ← Hub-level config (NEW)
├── registry/                            ← Master copy of all registries (NEW)
│   ├── frontend.md
│   ├── demo-engine.md
│   ├── demo-admin.md
│   ├── device-manager.md
│   ├── plugin.md
│   ├── discovery.md
│   └── lifecycle.md
├── directives/                          ← High-level requirements (NEW)
│   ├── dir-001-add-oauth.md
│   └── dir-002-device-audit.md
├── contracts/                           ← All service contracts (EXISTING)
│   ├── frontend.yaml
│   ├── demo-engine.yaml
│   ├── demo-admin.yaml
│   ├── device-manager.yaml
│   └── internal/                        ← Internal contract backups (EXISTING)
│       └── device-manager/
│           ├── plugin.md
│           ├── discovery.md
│           └── lifecycle.md
└── comms/
    ├── inbox/
    │   ├── orchestrator/                ← Orchestrator inbox (NEW)
    │   ├── frontend/                    ← Service inboxes (EXISTING)
    │   ├── demo-engine/
    │   ├── demo-admin/
    │   └── device-manager/
    ├── archive/                         ← Permanent archive (EXISTING, never purge)
    └── history/                         ← State transition audit log (NEW)
        └── 2026-02-10.jsonl
```

**What's new at root level:**
- `CLAUDE.md` — orchestrator agent instructions
- `.claude/commands/` — orchestrator slash commands
- `config.yaml` — hub-level configuration
- `directives/` — high-level requirement files
- `registry/` — master copy of all service/module registries

**What's new under `comms/`:**
- `comms/inbox/orchestrator/` — services send escalated requests here
- `comms/history/` — append-only audit log (JSONL)

Everything else already exists in the v1 hub structure.

---

## 8. Orchestrator

### 8.1 What It Is

The orchestrator is a **Claude Code session running on the hub repo**. It has:
- Read access to all registries (who owns what)
- Read access to all contracts (what APIs exist)
- Read/write access to all inboxes (to dispatch and receive)
- Read/write access to directives (to decompose and track)

It does NOT have access to service source code. It works entirely through the protocol.

### 8.2 Behaviors

The orchestrator follows four behaviors, injected via its `CLAUDE.md`:

| Behavior | Trigger | Action |
|----------|---------|--------|
| **ON_START** | Session begins | Read `config.yaml`, load all `registry/*.md`, check `comms/inbox/orchestrator/` for escalated requests, report status of active directives |
| **ON_DIRECTIVE** | New directive in `directives/` with `status: pending` | Read directive, analyze requirement against registries and contracts, decompose into per-service requests, dispatch to service inboxes, update directive status to `in-progress` |
| **ON_ROUTE** | New request in `comms/inbox/orchestrator/` | Read escalated request, consult registries to determine correct target, create new request in target service inbox with attribution, optionally link to existing directive |
| **ON_MONITOR** | Periodic or on-demand | Scan all service inboxes and archive for requests linked to active directives, update directive decomposition table and status, report progress |

### 8.3 Orchestrator Config

The hub's `config.yaml` identifies this repo as the orchestrator:

```yaml
version: "0.2"
role: orchestrator

project:
  name: next-demo
  description: "Next-generation Network Access Control system"

services:
  - name: frontend
    repo: git@github.com:org/frontend.git
  - name: demo-engine
    repo: git@github.com:org/demo-engine.git
  - name: demo-admin
    repo: git@github.com:org/demo-admin.git
  - name: device-manager
    repo: git@github.com:org/device-manager.git

settings:
  sync_mode: on-action
  require_human_approval: true
  archive_completed: true
  history_enabled: true
```

The `role: orchestrator` field distinguishes the hub config from service configs.

---

## 9. Audit Trail

### 9.1 Archive (Existing, Enhanced)

v1 already archives completed/rejected requests to `comms/archive/`. v2 makes one rule
change:

> **Archive is permanent. Never delete or purge archived requests.**

This ensures full traceability from any directive back to every request it spawned,
including their final state and any rejection reasons.

### 9.2 History Log (New)

The `comms/history/` directory contains append-only JSONL files — one per day:

```
comms/history/
├── 2026-02-10.jsonl
├── 2026-02-11.jsonl
└── ...
```

Each line records a single state transition:

```json
{"ts":"2026-02-10T10:05:00Z","request_id":"req-101","directive_id":"dir-001","from_status":"pending","to_status":"approved","actor":"demo-engine","detail":"Approved OAuth endpoint addition"}
{"ts":"2026-02-10T11:30:00Z","request_id":"req-101","directive_id":"dir-001","from_status":"approved","to_status":"in-progress","actor":"demo-engine","detail":"Implementation started"}
{"ts":"2026-02-10T15:00:00Z","request_id":"req-101","directive_id":"dir-001","from_status":"in-progress","to_status":"completed","actor":"demo-engine","detail":"Contract updated, archived"}
```

**History entry fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `ts` | Yes | ISO 8601 timestamp |
| `request_id` | Yes | The request that transitioned |
| `directive_id` | No | Parent directive (if any) |
| `from_status` | Yes | Previous status |
| `to_status` | Yes | New status |
| `actor` | Yes | Service/module that performed the transition |
| `detail` | No | Human-readable description |

### 9.3 Traceability Chain

```
Directive (dir-001-add-oauth)
    │
    ├── Request req-101 (demo-engine: add OAuth endpoints)
    │       └── History: pending → approved → in-progress → completed
    │
    ├── Request req-102 (frontend: add login page)
    │       └── History: pending → approved → in-progress → completed
    │
    └── Request req-103 (demo-admin: OAuth config UI)
            └── History: pending → rejected (reason: out of scope for v1)
```

The orchestrator can reconstruct this chain at any time by reading the directive's `requests`
list, the archived request files, and the history log.

---

## 10. Service Scheduler

In v1, each service session is started manually. v2 introduces an optional **scheduler**
that automates service execution.

### 10.1 `accord-scheduler.sh`

A lightweight script that runs on each service machine (or in CI):

```
accord-scheduler.sh [--mode auto|manual] [--interval 300]
```

| Mode | Behavior |
|------|----------|
| `auto` | Loop: pull from hub → check inbox → if pending requests exist, run `claude -p "process inbox"` → push results → sleep interval |
| `manual` | Pull from hub → check inbox → print status → exit (human decides what to do) |

### 10.2 End-to-End Sequence

```
   User              Orchestrator (hub)           Service Node
    │                      │                          │
    │  write directive     │                          │
    ├─────────────────────►│                          │
    │                      │                          │
    │               ON_DIRECTIVE                      │
    │               decompose + dispatch              │
    │                      │                          │
    │                      │   request → inbox        │
    │                      ├─────────────────────────►│
    │                      │                          │
    │                      │              scheduler pulls
    │                      │              agent processes
    │                      │              agent pushes result
    │                      │                          │
    │                      │   ◄──── completed ───────┤
    │                      │                          │
    │               ON_MONITOR                        │
    │               update directive                  │
    │                      │                          │
    │  ◄── report ─────────┤                          │
    │  "dir-001: 2/3 done" │                          │
```

### 10.3 Human-in-the-Loop

The scheduler respects the `require_human_approval` setting. When set to `true`:
- The scheduler (in `auto` mode) only processes **approved** requests automatically
- **Pending** requests are reported but require human approval before execution
- This preserves v1's human approval gate

---

## 11. End-to-End Workflow

### 11.1 Orchestrator-Initiated: Add OAuth2

**Step 1: User creates directive**

The user writes `directives/dir-001-add-oauth.md` on the hub repo:

```yaml
---
id: dir-001-add-oauth
title: Add OAuth2 Authentication
priority: high
status: pending
created: 2026-02-10T10:00:00Z
updated: 2026-02-10T10:00:00Z
requests: []
---

## Requirement
Add OAuth2 with Google and GitHub providers across all services.
```

**Step 2: Orchestrator decomposes (ON_DIRECTIVE)**

The orchestrator reads all registries, determines which services are affected, and creates
three requests:

```
comms/inbox/demo-engine/req-101-oauth-endpoints.md    (scope: api auth)
comms/inbox/frontend/req-102-oauth-login-page.md     (scope: UI)
comms/inbox/demo-admin/req-103-oauth-config-ui.md     (scope: admin panel)
```

Updates the directive:
```yaml
status: in-progress
requests: [req-101, req-102, req-103]
```

Updates decomposition table:
```
| Request | Target | Status |
|---------|--------|--------|
| req-101-oauth-endpoints | demo-engine | pending |
| req-102-oauth-login-page | frontend | pending |
| req-103-oauth-config-ui | demo-admin | pending |
```

Commits and pushes to hub.

**Step 3: Services process requests**

Each service pulls from hub (via scheduler or manually), finds pending requests:
- demo-engine approves req-101, implements OAuth middleware, completes
- frontend approves req-102, implements login page, completes
- demo-admin rejects req-103 with reason: "admin OAuth config is handled by demo-engine's config file"

**Step 4: Orchestrator monitors (ON_MONITOR)**

Orchestrator pulls, sees:
- req-101: completed
- req-102: completed
- req-103: rejected

Updates directive status and reports to user: "dir-001: 2/3 completed, 1 rejected.
demo-admin rejected req-103 — admin OAuth config is handled by demo-engine. Directive
partially complete. Action needed: review rejection."

### 11.2 Service-Escalated: Device Manager Needs Policy Data

**Step 1: device-manager sends to orchestrator**

device-manager doesn't know who owns policy data. It sends to the orchestrator:

```yaml
---
id: req-201-need-policy-api
from: device-manager
to: orchestrator
type: api-addition
status: pending
---
## What
Need an API to query policies by device type after discovery.
```

**Step 2: Orchestrator routes (ON_ROUTE)**

Orchestrator reads `registry/demo-engine.md`, finds:
```
## Owns
- Policy rules and evaluation engine
- Policy-device-type mappings
```

Creates a new request in demo-engine's inbox:

```yaml
---
id: req-202-policy-by-device-type
from: device-manager
to: demo-engine
type: api-addition
status: pending
routed_by: orchestrator
originated_from: req-201-need-policy-api
---
```

Responds to device-manager by updating req-201 status to `completed` with a note:
"Routed to demo-engine as req-202."

---

## 12. Config Extensions

### 12.1 Hub Config (`config.yaml`)

New fields for v2:

```yaml
version: "0.2"
role: orchestrator           # NEW: identifies this as the orchestrator hub

settings:
  history_enabled: true      # NEW: enable comms/history/ audit log
```

### 12.2 Service Config (`.accord/config.yaml`)

No changes required. Services continue using v1 config as-is. The orchestrator
is transparent to services — they just see normal requests in their inbox.

### 12.3 Request Format

One new optional field:

```yaml
directive: dir-001-add-oauth     # Optional. Links request to parent directive.
routed_by: orchestrator           # Optional. Set when orchestrator re-routes.
originated_from: req-201          # Optional. Original escalated request ID.
```

All three are optional and backward-compatible. v1 services ignore unknown frontmatter fields.

---

## 13. Design Decisions

### Why the hub as orchestrator workspace?

The hub already has all contracts, all registries (via sync), and all inboxes. It's the
natural location for a central intelligence. Running the orchestrator on a service repo
would require syncing everything locally first — the hub already has it.

### Why flat structure (no `.accord/` in hub)?

v1 established the convention: hub repos use a flat layout. Nesting under `.accord/` would
break the existing `accord sync push/pull` contracts. v2 maintains this convention.

### Why centralized routing + v1 fallback?

Centralized routing through the orchestrator is more reliable (uses registry knowledge) and
enables feature tracking (via directives). But forcing all communication through the
orchestrator would create a bottleneck and break v1 compatibility. Keeping direct routing
as a fallback means v1 projects upgrade seamlessly.

### Why directives are hub-only?

Directives are an orchestrator concept — they represent system-wide requirements that span
services. Individual services don't need to know about directives; they just process requests.
Keeping directives on the hub keeps service repos clean and avoids sync complexity.

### Why a scheduler instead of always-on agents?

Always-on agents are expensive (token costs) and unnecessary. Most requests can wait minutes
or hours for processing. A lightweight scheduler that checks periodically is more practical.
The `manual` mode preserves full human control for teams that want it.

### Why JSONL for history?

- Append-only: safe for concurrent writes (each push appends lines)
- One file per day: easy to manage, easy to grep
- Machine-readable: tools can parse and visualize
- Human-readable: each line is self-contained JSON
- Git-friendly: appending lines produces clean diffs

### Why `routed_by` and `originated_from` instead of modifying `from`?

The `from` field should always reflect the actual requester (who needs the change). Adding
`routed_by` preserves the routing information separately. This means demo-engine sees
"device-manager needs this" (actionable) rather than "orchestrator needs this" (opaque).

---

## 14. Migration

### Service Repos: Zero Changes

v2 is fully backward-compatible at the service level:
- Service `.accord/config.yaml` — no changes
- Service `accord sync pull/push` — works as before
- Service inbox processing — unchanged
- New frontmatter fields (`directive`, `routed_by`, `originated_from`) — unknown fields are ignored

### Hub Repo: Additive Only

To enable v2, add to the existing hub:

1. `CLAUDE.md` — orchestrator instructions (new file)
2. `.claude/commands/` — orchestrator slash commands (new directory)
3. `config.yaml` — hub config with `role: orchestrator` (new file)
4. `registry/` — copy registry files from services (new directory, or populated via sync)
5. `directives/` — create empty directory (new)
6. `comms/inbox/orchestrator/` — create empty directory (new)
7. `comms/history/` — create empty directory (new)

No existing hub files are modified or moved.

---

## 15. Future Extensions

These are out of scope for the initial v2 but follow naturally from this architecture:

- **Dashboard**: Web UI reading `directives/`, `comms/archive/`, and `comms/history/` to
  show feature progress across services. Pure read-only — no backend needed, just a static
  page parsing files.

- **Dependency-aware dispatch**: Orchestrator detects that req-102 (frontend login page)
  depends on req-101 (backend auth endpoints) and adds a `blocked_by: req-101` field.
  Services process only unblocked requests.

- **Auto-approval**: For low-risk request types (e.g., `question`, `bug-report`), skip
  human approval. Configured per-service in config.yaml.

- **Cross-project orchestration**: Multiple hub repos, each with their own orchestrator,
  coordinated by a meta-orchestrator. Same fractal protocol, one level up.

- **Directive templates**: Pre-built directive templates for common patterns ("add CRUD
  endpoint", "add authentication", "add monitoring") with pre-filled decomposition hints.

- **Cost tracking**: Track token usage per directive by logging agent invocation costs
  alongside state transitions in the history log.
