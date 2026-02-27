

















# device-manager — Agent Memory

## Service Info
- Tech stack: Java 17, Spring Boot 3.2.0
- Repository: In-memory ConcurrentHashMap implementation
- API: RESTful endpoints at /api/devices

## Recent Changes
- 2026-02-13: req-001-add-batch-delete-api — Added batch delete API endpoint
  - Created POST /api/devices/batch-delete endpoint
  - Implemented BatchDeleteRequest and BatchDeleteResponse DTOs with proper JSON property mapping
  - Added deleteById and existsById methods to DeviceRepository
  - Implemented batchDeleteDevices in DeviceService with error handling for partial failures
  - Created InMemoryDeviceRepository implementation
  - Added comprehensive controller and service layer tests (9 tests total, all passing)
  - Updated device-manager.yaml contract with batch delete endpoint specification
- 2026-02-14: req-002-add-interface-management — Added interface management functionality
  - Created NetworkInterface entity with InterfaceType and InterfaceStatus enums
  - Created NetworkInterfaceRepository interface and InMemoryNetworkInterfaceRepository implementation
  - Created NetworkInterfaceService with comprehensive validation (MAC address, IP address, interface name formats)
  - Created NetworkInterfaceController with 5 REST endpoints:
    - GET /api/devices/{deviceId}/interfaces — list all interfaces for a device
    - GET /api/devices/{deviceId}/interfaces/{interfaceId} — get specific interface
    - POST /api/devices/{deviceId}/interfaces — create new interface
    - PUT /api/devices/{deviceId}/interfaces/{interfaceId} — update interface
    - DELETE /api/devices/{deviceId}/interfaces/{interfaceId} — delete interface
  - Created CreateInterfaceRequest and UpdateInterfaceRequest DTOs with JSON property mapping
  - Implemented validation rules:
    - MAC address format: XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX
    - IP address format: standard IPv4 validation
    - Interface name: alphanumeric, hyphens, underscores only
    - Device existence check before creating interface
  - Added 24 comprehensive tests (14 service tests, 10 controller tests) — all passing
  - Updated device-manager.yaml contract with interface management endpoints marked as proposed
- 2026-02-14: req-003-add-all-interfaces-endpoint — Added global interfaces query endpoint
  - Created new GET /api/interfaces endpoint for system-wide interface queries
  - Implemented query parameter filtering (deviceId, type, status, enabled)
  - Implemented pagination with configurable page and pageSize (max 100)
  - Created response DTOs: InterfaceWithDevice, PaginationMetadata, AllInterfacesResponse
  - Extended NetworkInterfaceRepository with findAllWithFilters and countWithFilters methods
  - Extended NetworkInterfaceService with listAllInterfaces method
  - Created AllInterfacesController with comprehensive parameter validation
  - Enriched interface responses with device names (JOIN with Device table)
  - Implemented pagination metadata calculation (page, pageSize, totalItems, totalPages)
  - Added 14 comprehensive tests (6 service tests, 8 controller tests) — all passing (47 total tests)
  - Updated device-manager.yaml contract with new /api/interfaces endpoint marked as proposed
- 2026-02-14: req-004-add-batch-delete-interfaces — Added batch delete operation for interfaces
  - Created POST /api/interfaces/batch-delete endpoint
  - Implemented BatchDeleteInterfacesRequest and BatchDeleteInterfacesResponse DTOs with proper JSON property mapping
  - Extended NetworkInterfaceRepository with findByIds and deleteByIds methods
  - Extended NetworkInterfaceService with batchDeleteInterfaces method
  - Implemented partial success handling (deleted vs. failed interfaces)
  - Added validation: non-empty list, max 100 interfaces per request
  - Added 10 comprehensive tests (6 service tests, 4 controller tests)
  - Updated device-manager.yaml contract with batch delete endpoint marked as proposed
- 2026-02-14: req-006-add-interface-api-tests — Completed comprehensive test coverage for all interface APIs
  - Re-added batch delete functionality (DTOs, repository methods, service methods, controller endpoint) that was previously lost
  - Re-added missing batch delete tests (4 controller tests, 6 service tests)
  - Fixed test code to match actual DTO structure and method signatures
  - All 57 tests now passing (24 interface management + 14 global query + 10 batch delete + 9 device tests)
  - Verified comprehensive coverage for all interface endpoints including edge cases and error scenarios
- 2026-02-15: req-007-add-device-auth-fields — Added authentication fields to Device entity
  - Created AuthType enum with values: NONE, BASIC, TOKEN, SSH_KEY, CERTIFICATE, API_KEY
  - Updated Device entity with authentication fields:
    - authUsername, authPassword (encrypted), authToken, authType
    - sshPublicKey, certificate (for certificate-based auth)
    - authEnabled, lastAuthUpdate (timestamp)
  - Added Spring Security dependency (spring-boot-starter-security) to pom.xml
  - Configured PasswordEncoder bean using BCryptPasswordEncoder for password encryption
  - Updated SecurityConfig to disable authentication for all endpoints (only using PasswordEncoder for device password storage)
  - Updated DeviceServiceImpl to automatically encrypt passwords when creating devices
  - Added sanitizeDevice() method in DeviceController to ensure passwords are never returned in API responses
  - Updated DeviceController GET endpoints to sanitize devices (password set to null in responses)
  - Added 6 comprehensive tests for authentication fields (service layer):
    - Password encryption for BASIC auth
    - lastAuthUpdate set for TOKEN, SSH_KEY, CERTIFICATE auth types
    - No encryption when no auth fields provided
    - No encryption for empty passwords
  - Added 4 comprehensive tests for controller layer:
    - Password not returned in GET /api/devices/{id}
    - Password not returned in GET /api/devices (list)
    - Token, SSH key returned normally (only password is hidden)
  - Updated device-manager.yaml contract with Device schema including auth fields (marked as proposed)
  - All 67 tests passing (10 device service + 9 device controller + 12 all-interfaces controller + 10 network-interface controller + 26 network-interface service)




<!-- ACCORD START — do not edit this block manually. Managed by accord. -->

# Accord Protocol Rules — device-manager

You are an AI coding agent for the **device-manager** service in team **zliu** (project: **demo-hub**).

## Service Identity

- **Service**: device-manager
- **Team**: zliu
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
│       └── */teams/zliu/
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

**Shorthand**: `$HUB` = `.accord/.hub/*/teams/zliu`

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
   `teams/{target-team}/.accord/comms/inbox/_team/req-cross-{id}.md`
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
