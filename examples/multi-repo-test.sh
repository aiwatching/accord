#!/usr/bin/env bash
# Accord Multi-Repo End-to-End Test
#
# Tests the full hub-and-spoke lifecycle:
#   1. Create a bare hub repo + two service repos
#   2. web-server sends a request to device-manager via hub
#   3. device-manager receives, approves, implements, completes
#   4. web-server pulls and sees the updated contract
#
# Usage: ./examples/multi-repo-test.sh [--keep]

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KEEP=false
[[ "${1:-}" == "--keep" ]] && KEEP=true

# ── Helpers ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

TESTS=0
PASSED=0
FAILED=0

pass() { echo -e "  ${GREEN}PASS${NC}  $*"; TESTS=$((TESTS + 1)); PASSED=$((PASSED + 1)); }
fail() { echo -e "  ${RED}FAIL${NC}  $*"; TESTS=$((TESTS + 1)); FAILED=$((FAILED + 1)); }

assert_file() {
    if [[ -f "$1" ]]; then pass "$2"; else fail "$2 — file not found: $1"; fi
}
assert_dir() {
    if [[ -d "$1" ]]; then pass "$2"; else fail "$2 — dir not found: $1"; fi
}
assert_contains() {
    if grep -q "$2" "$1" 2>/dev/null; then pass "$3"; else fail "$3 — '$2' not found in $1"; fi
}
assert_not_file() {
    if [[ ! -f "$1" ]]; then pass "$2"; else fail "$2 — file exists (unexpected): $1"; fi
}

# ── Setup ─────────────────────────────────────────────────────────────────────
TMPDIR=$(mktemp -d)
trap '[[ "$KEEP" == false ]] && rm -rf "$TMPDIR"' EXIT

echo -e "\n${BOLD}=== Accord Multi-Repo End-to-End Test ===${NC}"
echo -e "Temp dir: $TMPDIR\n"

# ══════════════════════════════════════════════════════════════════════════════
# Phase 1: Setup — Create hub + two service repos
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}[Phase 1] Setup — hub + service repos${NC}"

# 1a. Create bare hub repo (simulates GitHub remote)
HUB_BARE="$TMPDIR/hub.git"
git init --bare "$HUB_BARE" > /dev/null 2>&1

# Initialize hub with .accord/ structure via a temp clone
HUB_INIT="$TMPDIR/hub-init"
git clone "$HUB_BARE" "$HUB_INIT" > /dev/null 2>&1
(
    cd "$HUB_INIT"
    git config user.email "test@accord.dev"
    git config user.name "Accord Test"
    mkdir -p .accord/contracts .accord/contracts/internal
    mkdir -p .accord/comms/inbox/web-server .accord/comms/inbox/device-manager
    mkdir -p .accord/comms/archive
    touch .accord/comms/inbox/web-server/.gitkeep
    touch .accord/comms/inbox/device-manager/.gitkeep
    touch .accord/comms/archive/.gitkeep
    git add -A && git commit -m "accord: init hub" > /dev/null 2>&1
    git push > /dev/null 2>&1
)
rm -rf "$HUB_INIT"

assert_dir "$HUB_BARE" "Bare hub repo created"

# 1b. Create web-server repo
WEB_DIR="$TMPDIR/web-server"
mkdir -p "$WEB_DIR/src"
(cd "$WEB_DIR" && git init > /dev/null 2>&1 && git config user.email "test@accord.dev" && git config user.name "Accord Test")

bash "$ACCORD_DIR/init.sh" \
    --project-name "next-demo" \
    --repo-model multi-repo \
    --services "web-server,device-manager" \
    --hub "$HUB_BARE" \
    --adapter none \
    --target-dir "$WEB_DIR" \
    --no-interactive > /dev/null 2>&1

(cd "$WEB_DIR" && git add -A && git commit -m "init web-server" > /dev/null 2>&1)

assert_file "$WEB_DIR/.accord/config.yaml" "web-server config created"
assert_contains "$WEB_DIR/.accord/config.yaml" "multi-repo" "web-server config is multi-repo"
assert_contains "$WEB_DIR/.accord/config.yaml" "$HUB_BARE" "web-server config has hub URL"

# 1c. Create device-manager repo
DM_DIR="$TMPDIR/device-manager"
mkdir -p "$DM_DIR/src"
(cd "$DM_DIR" && git init > /dev/null 2>&1 && git config user.email "test@accord.dev" && git config user.name "Accord Test")

# device-manager is the first service listed (own service)
bash "$ACCORD_DIR/init.sh" \
    --project-name "next-demo" \
    --repo-model multi-repo \
    --services "device-manager,web-server" \
    --hub "$HUB_BARE" \
    --adapter none \
    --target-dir "$DM_DIR" \
    --no-interactive > /dev/null 2>&1

(cd "$DM_DIR" && git add -A && git commit -m "init device-manager" > /dev/null 2>&1)

assert_file "$DM_DIR/.accord/config.yaml" "device-manager config created"

# 1d. Both repos clone hub
echo -e "\n${BOLD}[Phase 1d] Clone hub into both repos${NC}"

bash "$ACCORD_DIR/accord-sync.sh" init --target-dir "$WEB_DIR" --service-name web-server > /dev/null 2>&1
assert_dir "$WEB_DIR/.accord/hub/.git" "web-server hub cloned"
assert_dir "$WEB_DIR/.accord/hub/.accord/comms/inbox/web-server" "Hub has web-server inbox"
assert_dir "$WEB_DIR/.accord/hub/.accord/comms/inbox/device-manager" "Hub has device-manager inbox"

bash "$ACCORD_DIR/accord-sync.sh" init --target-dir "$DM_DIR" --service-name device-manager > /dev/null 2>&1
assert_dir "$DM_DIR/.accord/hub/.git" "device-manager hub cloned"

# ══════════════════════════════════════════════════════════════════════════════
# Phase 2: web-server sends a request to device-manager
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Phase 2] web-server creates a request → pushes to hub${NC}"

# Create a request in device-manager's inbox (locally on web-server side)
mkdir -p "$WEB_DIR/.accord/comms/inbox/device-manager"
cat > "$WEB_DIR/.accord/comms/inbox/device-manager/req-001-list-devices.md" <<'EOF'
---
id: req-001-list-devices
from: web-server
to: device-manager
scope: external
type: api-addition
priority: high
status: pending
created: 2026-02-10T10:00:00Z
updated: 2026-02-10T10:00:00Z
related_contract: .accord/contracts/device-manager.yaml
---

## What

Need a GET /api/devices endpoint to list all managed devices.

## Proposed Change

```yaml
paths:
  /api/devices:
    get:
      summary: "List all devices"
      responses:
        '200':
          description: "List of devices"
```

## Why

The web dashboard needs to display a device inventory table.

## Impact

- New DevicesController
- New Device model/DTO
- Database query for device listing
EOF

assert_file "$WEB_DIR/.accord/comms/inbox/device-manager/req-001-list-devices.md" "Request file created"

# Validate the request
if bash "$ACCORD_DIR/protocol/scan/validators/validate-request.sh" \
    "$WEB_DIR/.accord/comms/inbox/device-manager/req-001-list-devices.md" > /dev/null 2>&1; then
    pass "Request passes validation"
else
    fail "Request does not pass validation"
fi

# Push to hub
bash "$ACCORD_DIR/accord-sync.sh" push --target-dir "$WEB_DIR" --service-name web-server > /dev/null 2>&1

# Verify: request is now in hub
# Pull hub clone in web-server to check (it was just pushed, so the local clone should have it)
(cd "$WEB_DIR/.accord/hub" && git pull --quiet > /dev/null 2>&1)
assert_file "$WEB_DIR/.accord/hub/.accord/comms/inbox/device-manager/req-001-list-devices.md" \
    "Request appeared in hub's device-manager inbox"

# Also verify web-server's own contract was pushed to hub
assert_file "$WEB_DIR/.accord/hub/.accord/contracts/web-server.yaml" \
    "web-server contract pushed to hub"

# ══════════════════════════════════════════════════════════════════════════════
# Phase 3: device-manager receives and processes the request
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Phase 3] device-manager pulls request from hub${NC}"

# Pull from hub
bash "$ACCORD_DIR/accord-sync.sh" pull --target-dir "$DM_DIR" --service-name device-manager > /dev/null 2>&1

# Verify: request appeared in device-manager's local inbox
assert_file "$DM_DIR/.accord/comms/inbox/device-manager/req-001-list-devices.md" \
    "Request arrived in device-manager local inbox"
assert_contains "$DM_DIR/.accord/comms/inbox/device-manager/req-001-list-devices.md" \
    "status: pending" "Request has pending status"

# Also verify: device-manager can now see web-server's contract
assert_file "$DM_DIR/.accord/contracts/web-server.yaml" \
    "device-manager can see web-server contract"

echo -e "\n${BOLD}[Phase 3b] device-manager processes the request lifecycle${NC}"

REQ_FILE="$DM_DIR/.accord/comms/inbox/device-manager/req-001-list-devices.md"

# Step 1: Approve
sed 's/status: pending/status: approved/' "$REQ_FILE" > "${REQ_FILE}.tmp" && mv "${REQ_FILE}.tmp" "$REQ_FILE"
sed 's/updated: 2026-02-10T10:00:00Z/updated: 2026-02-10T11:00:00Z/' "$REQ_FILE" > "${REQ_FILE}.tmp" && mv "${REQ_FILE}.tmp" "$REQ_FILE"
assert_contains "$REQ_FILE" "status: approved" "Request approved"

# Step 2: In-progress
sed 's/status: approved/status: in-progress/' "$REQ_FILE" > "${REQ_FILE}.tmp" && mv "${REQ_FILE}.tmp" "$REQ_FILE"
sed 's/updated: 2026-02-10T11:00:00Z/updated: 2026-02-10T12:00:00Z/' "$REQ_FILE" > "${REQ_FILE}.tmp" && mv "${REQ_FILE}.tmp" "$REQ_FILE"
assert_contains "$REQ_FILE" "status: in-progress" "Request in-progress"

# Step 3: Implement — update device-manager contract with /api/devices endpoint
cat > "$DM_DIR/.accord/contracts/device-manager.yaml" <<'EOF'
openapi: "3.0.3"
info:
  title: "device-manager API"
  version: "0.1.0"
  x-accord-status: stable
paths:
  /api/example/{id}:
    get:
      summary: "Get example by ID"
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: "OK"
  /api/devices:
    get:
      summary: "List all devices"
      operationId: listDevices
      responses:
        '200':
          description: "List of devices"
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Device'
components:
  schemas:
    Device:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
        type:
          type: string
        status:
          type: string
      required:
        - id
        - name
EOF

# Validate updated contract
if bash "$ACCORD_DIR/protocol/scan/validators/validate-openapi.sh" \
    "$DM_DIR/.accord/contracts/device-manager.yaml" > /dev/null 2>&1; then
    pass "Updated device-manager contract validates"
else
    fail "Updated device-manager contract failed validation"
fi

# Step 4: Complete — mark completed and archive
sed 's/status: in-progress/status: completed/' "$REQ_FILE" > "${REQ_FILE}.tmp" && mv "${REQ_FILE}.tmp" "$REQ_FILE"
sed 's/updated: 2026-02-10T12:00:00Z/updated: 2026-02-10T13:00:00Z/' "$REQ_FILE" > "${REQ_FILE}.tmp" && mv "${REQ_FILE}.tmp" "$REQ_FILE"
assert_contains "$REQ_FILE" "status: completed" "Request completed"

mkdir -p "$DM_DIR/.accord/comms/archive"
mv "$REQ_FILE" "$DM_DIR/.accord/comms/archive/req-001-list-devices.md"
assert_file "$DM_DIR/.accord/comms/archive/req-001-list-devices.md" "Request moved to archive"
assert_not_file "$REQ_FILE" "Request removed from inbox"

# Step 5: Push completed work to hub
bash "$ACCORD_DIR/accord-sync.sh" push --target-dir "$DM_DIR" --service-name device-manager > /dev/null 2>&1
pass "device-manager pushed to hub"

# ══════════════════════════════════════════════════════════════════════════════
# Phase 4: web-server pulls and sees the result
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Phase 4] web-server pulls and sees updated contract${NC}"

bash "$ACCORD_DIR/accord-sync.sh" pull --target-dir "$WEB_DIR" --service-name web-server > /dev/null 2>&1

# Verify: web-server now has device-manager's updated contract with /api/devices
assert_contains "$WEB_DIR/.accord/contracts/device-manager.yaml" "/api/devices" \
    "web-server sees /api/devices in device-manager contract"
assert_contains "$WEB_DIR/.accord/contracts/device-manager.yaml" "listDevices" \
    "web-server sees listDevices operation"

# Validate the pulled contract
if bash "$ACCORD_DIR/protocol/scan/validators/validate-openapi.sh" \
    "$WEB_DIR/.accord/contracts/device-manager.yaml" > /dev/null 2>&1; then
    pass "Pulled device-manager contract validates on web-server side"
else
    fail "Pulled device-manager contract failed validation on web-server side"
fi

# Verify: request is archived in hub
(cd "$WEB_DIR/.accord/hub" && git pull --quiet > /dev/null 2>&1)
assert_file "$WEB_DIR/.accord/hub/.accord/comms/archive/req-001-list-devices.md" \
    "Request is archived in hub"
assert_contains "$WEB_DIR/.accord/hub/.accord/comms/archive/req-001-list-devices.md" \
    "status: completed" "Archived request has completed status"

# Verify: updated contract is in hub
assert_contains "$WEB_DIR/.accord/hub/.accord/contracts/device-manager.yaml" "/api/devices" \
    "Hub has updated device-manager contract with /api/devices"

# ══════════════════════════════════════════════════════════════════════════════
# Phase 5: Edge cases and robustness
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Phase 5] Edge cases${NC}"

# 5a. Pull with no new requests — should not fail
bash "$ACCORD_DIR/accord-sync.sh" pull --target-dir "$WEB_DIR" --service-name web-server > /dev/null 2>&1
pass "Pull with no new requests succeeds"

# 5b. Push with no changes — should not fail
bash "$ACCORD_DIR/accord-sync.sh" push --target-dir "$WEB_DIR" --service-name web-server > /dev/null 2>&1
pass "Push with no changes succeeds"

# 5c. Init when hub already cloned — should just pull
bash "$ACCORD_DIR/accord-sync.sh" init --target-dir "$WEB_DIR" --service-name web-server > /dev/null 2>&1
pass "Init when hub already cloned succeeds (idempotent)"

# 5d. Verify own contract is not overwritten by pull
# (web-server should keep its own contract, not get overwritten by hub's copy)
local_contract_before=$(cat "$WEB_DIR/.accord/contracts/web-server.yaml")
bash "$ACCORD_DIR/accord-sync.sh" pull --target-dir "$WEB_DIR" --service-name web-server > /dev/null 2>&1
local_contract_after=$(cat "$WEB_DIR/.accord/contracts/web-server.yaml")
if [[ "$local_contract_before" == "$local_contract_after" ]]; then
    pass "Own contract not overwritten by pull"
else
    fail "Own contract was overwritten by pull"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}=== Multi-Repo Test Results ===${NC}"
echo -e "  Total: $TESTS, ${GREEN}Passed: $PASSED${NC}, ${RED}Failed: $FAILED${NC}"

if [[ "$KEEP" == true ]]; then
    echo -e "\n  Temp dir kept: $TMPDIR"
fi

if [[ $FAILED -gt 0 ]]; then
    exit 1
fi

echo -e "\n  ${GREEN}All multi-repo tests passed!${NC}"
exit 0
