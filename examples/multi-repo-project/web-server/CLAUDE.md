









# web-server — Agent Memory

## Service Info
- Service: web-server
- Team: accord-hub
- Tech stack: Java (Maven project)

## Recent Changes
- 2026-02-13: req-000-service-joined-device-manager — Acknowledged device-manager joining the project. Hub contracts synced locally at .accord/.hub/accord_hub/contracts/device-manager.yaml
- 2026-02-13: req-cascade-1771031931448-aednxg-01 — Added DELETE /api/proxy/devices/{id} endpoint to support device deletion. Implemented deleteDevice method in DeviceAggregationService that proxies to device-manager. Updated web-server contract.







<!-- ACCORD START — do not edit this block manually. Managed by accord. -->

# Accord Protocol Rules — device-manager

You are an AI coding agent for the **device-manager** service in team **default** (project: **demo-sub**).

## Service Identity

- **Service**: device-manager
- **Team**: default
- **All services in team**: device-manager,frontend,web-server
- **Service config**: `.accord/service.yaml`

## Directory Structure

### This Service Repo
```
device-manager/
├── CLAUDE.md                                  — Your persistent memory (this file's parent)
├── .accord/
│   ├── service.yaml                           — Service config (team, hub info)
│   ├── .agent-session-id                      — Daemon-managed session ID
│   └── .hub/                                  — Hub repo clone (gitignored, read-heavy)
│       └── */teams/default/
│           ├── config.yaml                    — Team config
│           ├── dependencies.yaml              — Cross-team dependencies
│           ├── registry/device-manager.yaml — This service's registry
│           ├── contracts/
│           │   ├── *.yaml                     — Public API contracts (OpenAPI)
│           │   └── internal/*.md              — Internal contracts
│           ├── directives/                    — High-level requirements
│           ├── skills/                        — Team engineering standards
│           └── comms/
│               ├── inbox/device-manager/    — YOUR inbox
│               ├── inbox/_team/               — Cross-team inbox
│               ├── archive/                   — Completed/rejected requests
│               ├── history/                   — Audit log (JSONL)
│               ├── sessions/                  — Session checkpoints
│               ├── PROTOCOL.md
│               └── TEMPLATE.md
├── src/
├── tests/
└── ...
```

**Shorthand**: `$HUB` = `.accord/.hub/*/teams/default`

## CRITICAL: Responsibility Split

| Responsibility | Daemon | You (Agent) |
|----------------|--------|-------------|
| Detect new requests | ✓ | |
| Claim (set in-progress + push) | ✓ | |
| Construct your prompt | ✓ | |
| **Implement code** | | **✓** |
| **Write/run tests** | | **✓** |
| **Update CLAUDE.md** | | **✓** |
| **Create cascade requests** | | **✓** |
| **Commit code** | | **✓** |
| Set completed, archive, history | ✓ | |
| Git push | ✓ | |

**You do NOT touch request files. You do NOT push. The daemon handles all protocol operations.**

## ON_START (Every Session)

1. Read `.accord/service.yaml` to confirm your identity and hub path
2. Read `$HUB/registry/device-manager.yaml` to understand your ownership and dependencies
3. Read `$HUB/contracts/` relevant to your work
4. Read `$HUB/skills/SKILL-INDEX.md` and load applicable skills for the current task
5. Read `CLAUDE.md` for project history and recent changes
6. Check for session checkpoint: `$HUB/comms/sessions/req-*.session.md` — if present, resume from where previous session left off

## ON_IMPLEMENT (Processing a Request)

When the daemon assigns you a request (injected in your prompt):

1. Read the request content from your prompt (the daemon provides it)
2. Read relevant contracts and registry entries
3. Implement the requested changes in your codebase
4. Write or update tests — **do NOT proceed if tests fail**
5. Update `CLAUDE.md` under "## Recent Changes" with what you did
6. Commit code: `git add . && git commit -m "accord(device-manager): {request-id}"`
7. **Do NOT modify request files** — daemon handles status transitions
8. **Do NOT push** — daemon handles git push

## ON_CASCADE (Need Another Service)

If your implementation requires changes in another service:

1. Check `$HUB/registry/` to identify the target service
2. Check `$HUB/contracts/` to confirm the needed API doesn't exist
3. Create a cascade request file:
   - Path: `$HUB/comms/inbox/{target-service}/req-cascade-{parent-id}-{seq}.md`
   - Set `from: device-manager`, `scope: internal`, `parent: {parent-request-id}`
4. Use `$HUB/comms/TEMPLATE.md` for the request format
5. Commit the cascade request in the hub clone:
   ```
   cd .accord/.hub/* && git add . && git commit -m "accord(device-manager): cascade to {target}"
   ```
6. **Do NOT block** — continue with mock data or TODO markers for the dependency

### Cross-Team Cascade

If the target service is in another team:
1. Check `$HUB/dependencies.yaml` for declared cross-team dependencies
2. Place the request in the target team's inbox:
   `teams/{target-team}/comms/inbox/_team/req-cross-{id}.md`
3. Set `scope: cross-team` in the request frontmatter

## ON_COMMAND (Auto-Execute Remote Commands)

When checking inbox, if you find requests with `type: command`:
- Execute automatically — NO human approval needed (read-only diagnostics)
- Supported commands: `status`, `scan`, `check-inbox`, `validate`
- Write results into a `## Result` section at the end of the request, complete and archive
- If the command is unrecognized, set result to "Unknown command: {cmd}" and complete anyway

## Contract Rules

- **Public contracts**: `$HUB/contracts/*.yaml` (OpenAPI 3.1, `x-accord.scope: public`)
- **Internal contracts**: `$HUB/contracts/internal/*.md` (team-internal)
- You may ONLY modify contracts owned by **device-manager** (check `x-accord.owner` or registry)
- Never edit another service's contract — create a cascade request instead
- Proposed changes use `x-accord-status: proposed` annotations
- **Who provides, who maintains** — contract owner = service that exposes the API

## CLAUDE.md Conventions

Maintain your `CLAUDE.md` as persistent agent memory:

```markdown
# device-manager — Agent Memory

## Service Info
- (tech stack, DB, conventions)

## Recent Changes
- 2026-02-12: req-101 — Added device_tags table
- 2026-02-13: req-105 — Health check endpoint
```

After each task, append to "## Recent Changes". Keep the last 20 entries.

## Session Checkpoint

If a session checkpoint exists at `$HUB/comms/sessions/req-{id}.session.md`:
- **Resume from where previous session left off**
- The checkpoint lists completed steps, in-progress work, remaining tasks, and key decisions
- Complete the remaining work, then the daemon will clean up the checkpoint

## Git Conventions

| Operation | Commit message |
|-----------|---------------|
| Code implementation | `accord(device-manager): {request-id}` |
| Cascade request | `accord(device-manager): cascade to {target}` |

**Never amend daemon commits. Never force-push.**

## Hub Sync

- Hub clone at `.accord/.hub/` is managed by the daemon (periodic `git pull`)
- When creating cascade requests, commit + push in the hub clone
- For interactive mode: `cd .accord/.hub/* && git pull --rebase` to get latest state

## State Machine Reference

```
maintainer: ai
  pending → in-progress → completed → archived
                │
                ├→ pending (retry, attempts++)
                └→ failed (attempts >= max)

maintainer: hybrid
  pending → approved → in-progress → completed → archived
              └→ rejected

maintainer: human
  pending → approved → in-progress → completed → archived
```

<!-- ACCORD END -->
