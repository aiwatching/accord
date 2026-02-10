#!/usr/bin/env bash
# Accord Integration Test
# Exercises the full lifecycle: init → create request → approve → complete → archive
#
# Usage: ./test.sh [--keep]
#   --keep: don't clean up temp directory after test (for debugging)

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")" && pwd)"
KEEP=false
[[ "${1:-}" == "--keep" ]] && KEEP=true

# ── Helpers ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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
assert_not_contains() {
    if ! grep -q "$2" "$1" 2>/dev/null; then pass "$3"; else fail "$3 — '$2' found in $1 (unexpected)"; fi
}
assert_validator() {
    if bash "$1" "$2" 2>/dev/null; then pass "$3"; else fail "$3 — validation failed"; fi
}

# ── Setup ─────────────────────────────────────────────────────────────────────
TMPDIR=$(mktemp -d)
trap '[[ "$KEEP" == false ]] && rm -rf "$TMPDIR"' EXIT

echo -e "\n${BOLD}=== Accord Integration Test ===${NC}"
echo -e "Temp dir: $TMPDIR\n"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 1: Basic init (monorepo, no modules, no adapter)
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}[Test 1] Basic init (monorepo, no adapter)${NC}"

TEST1_DIR="$TMPDIR/test1"
mkdir -p "$TEST1_DIR"

bash "$ACCORD_DIR/init.sh" \
    --project-name "test-basic" \
    --repo-model monorepo \
    --teams "alpha,beta" \
    --adapter none \
    --target-dir "$TEST1_DIR" \
    --no-interactive > /dev/null 2>&1

assert_file "$TEST1_DIR/.accord/config.yaml"               "Config created"
assert_file "$TEST1_DIR/.accord/contracts/alpha.yaml"       "Alpha contract created"
assert_file "$TEST1_DIR/.accord/contracts/beta.yaml"        "Beta contract created"
assert_dir  "$TEST1_DIR/.accord/comms/inbox/alpha"          "Alpha inbox created"
assert_dir  "$TEST1_DIR/.accord/comms/inbox/beta"           "Beta inbox created"
assert_file "$TEST1_DIR/.accord/comms/PROTOCOL.md"          "PROTOCOL.md created"
assert_file "$TEST1_DIR/.accord/comms/TEMPLATE.md"          "TEMPLATE.md created"
assert_contains "$TEST1_DIR/.accord/config.yaml" "test-basic" "Config has project name"
assert_contains "$TEST1_DIR/.accord/config.yaml" "monorepo"   "Config has repo model"

# Contract validation
assert_validator "$ACCORD_DIR/protocol/scan/validators/validate-openapi.sh" \
    "$TEST1_DIR/.accord/contracts/alpha.yaml" "Alpha contract validates"
assert_validator "$ACCORD_DIR/protocol/scan/validators/validate-openapi.sh" \
    "$TEST1_DIR/.accord/contracts/beta.yaml" "Beta contract validates"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 2: Init with service + modules
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 2] Init with service + modules${NC}"

TEST2_DIR="$TMPDIR/test2"
mkdir -p "$TEST2_DIR"

bash "$ACCORD_DIR/init.sh" \
    --project-name "test-modules" \
    --repo-model monorepo \
    --teams "svc-a,svc-b" \
    --service svc-a \
    --modules "mod-x,mod-y" \
    --language java \
    --adapter none \
    --target-dir "$TEST2_DIR" \
    --no-interactive > /dev/null 2>&1

assert_file "$TEST2_DIR/.accord/config.yaml"                          "Config created"
assert_file "$TEST2_DIR/.accord/contracts/internal/mod-x.md"          "mod-x internal contract"
assert_file "$TEST2_DIR/.accord/contracts/internal/mod-y.md"          "mod-y internal contract"
assert_dir  "$TEST2_DIR/.accord/comms/inbox/mod-x"                    "mod-x inbox"
assert_dir  "$TEST2_DIR/.accord/comms/inbox/mod-y"                    "mod-y inbox"
assert_contains "$TEST2_DIR/.accord/config.yaml" "mod-x"              "Config lists mod-x"
assert_contains "$TEST2_DIR/.accord/config.yaml" "modules:"           "Config has modules section"

# Internal contract validation
assert_validator "$ACCORD_DIR/protocol/scan/validators/validate-internal.sh" \
    "$TEST2_DIR/.accord/contracts/internal/mod-x.md" "mod-x internal validates"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 3: Idempotency — running init twice doesn't break things
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 3] Idempotency${NC}"

# Run init.sh again on test2
bash "$ACCORD_DIR/init.sh" \
    --project-name "test-modules" \
    --repo-model monorepo \
    --teams "svc-a,svc-b" \
    --service svc-a \
    --modules "mod-x,mod-y" \
    --language java \
    --adapter none \
    --target-dir "$TEST2_DIR" \
    --no-interactive > /dev/null 2>&1

# Verify nothing duplicated
config_count=$(grep -c "^  name: test-modules" "$TEST2_DIR/.accord/config.yaml" 2>/dev/null || echo 0)
if [[ "$config_count" -le 1 ]]; then pass "Config not duplicated"; else fail "Config duplicated"; fi

assert_file "$TEST2_DIR/.accord/contracts/internal/mod-x.md" "Contracts still exist after re-run"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 4: Claude Code adapter installation
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 4] Claude Code adapter${NC}"

TEST4_DIR="$TMPDIR/test4"
mkdir -p "$TEST4_DIR"

bash "$ACCORD_DIR/init.sh" \
    --project-name "test-adapter" \
    --repo-model monorepo \
    --teams "team-a,team-b" \
    --adapter claude-code \
    --target-dir "$TEST4_DIR" \
    --no-interactive > /dev/null 2>&1

assert_file "$TEST4_DIR/CLAUDE.md"                                 "CLAUDE.md created"
assert_file "$TEST4_DIR/.claude/commands/check-inbox.md"           "check-inbox command installed"
assert_file "$TEST4_DIR/.claude/commands/send-request.md"          "send-request command installed"
assert_file "$TEST4_DIR/.claude/commands/complete-request.md"      "complete-request command installed"
assert_file "$TEST4_DIR/.claude/commands/accord-scan.md"           "accord-scan command installed"
assert_file "$TEST4_DIR/.claude/commands/accord-init.md"           "accord-init command installed"
assert_file "$TEST4_DIR/.claude/skills/contract-scanner/SKILL.md"  "Scanner skill installed"

# Check variable substitution
assert_contains "$TEST4_DIR/CLAUDE.md" "test-adapter"    "CLAUDE.md has project name"
assert_contains "$TEST4_DIR/CLAUDE.md" "team-a"          "CLAUDE.md has team name"
assert_not_contains "$TEST4_DIR/CLAUDE.md" "{{PROJECT_NAME}}" "No unresolved vars in CLAUDE.md"
assert_contains "$TEST4_DIR/CLAUDE.md" "ACCORD START"    "Has ACCORD START marker"
assert_contains "$TEST4_DIR/CLAUDE.md" "ACCORD END"      "Has ACCORD END marker"

# Check centralized paths in CLAUDE.md
assert_contains "$TEST4_DIR/CLAUDE.md" ".accord/contracts/" "CLAUDE.md uses centralized contract path"
assert_contains "$TEST4_DIR/CLAUDE.md" ".accord/comms/"     "CLAUDE.md uses centralized comms path"

# Idempotency — run install again
bash "$ACCORD_DIR/adapters/claude-code/install.sh" \
    --project-dir "$TEST4_DIR" \
    --project-name "test-adapter" \
    --team-name "team-a" \
    --team-list "team-a,team-b" > /dev/null 2>&1

accord_blocks=$(grep -c "ACCORD START" "$TEST4_DIR/CLAUDE.md" 2>/dev/null || echo 0)
if [[ "$accord_blocks" -eq 1 ]]; then
    pass "Adapter idempotent (1 ACCORD block after re-install)"
else
    fail "Adapter not idempotent ($accord_blocks ACCORD blocks)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# TEST 5: Generic adapter installation
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 5] Generic adapter${NC}"

TEST5_DIR="$TMPDIR/test5"
mkdir -p "$TEST5_DIR"

bash "$ACCORD_DIR/init.sh" \
    --project-name "test-generic" \
    --repo-model monorepo \
    --teams "alpha,beta" \
    --adapter generic \
    --target-dir "$TEST5_DIR" \
    --no-interactive > /dev/null 2>&1

assert_file "$TEST5_DIR/.accord/adapter/AGENT_INSTRUCTIONS.md" "Generic instructions created"
assert_not_contains "$TEST5_DIR/.accord/adapter/AGENT_INSTRUCTIONS.md" "{{" "No unresolved vars"
assert_contains "$TEST5_DIR/.accord/adapter/AGENT_INSTRUCTIONS.md" "test-generic" "Has project name"
assert_contains "$TEST5_DIR/.accord/adapter/AGENT_INSTRUCTIONS.md" ".accord/contracts/" "Uses centralized paths"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 6: Full request lifecycle simulation
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 6] Full request lifecycle${NC}"

TEST6_DIR="$TMPDIR/test6"
mkdir -p "$TEST6_DIR"

bash "$ACCORD_DIR/init.sh" \
    --project-name "test-lifecycle" \
    --repo-model monorepo \
    --teams "frontend,backend" \
    --adapter none \
    --target-dir "$TEST6_DIR" \
    --no-interactive > /dev/null 2>&1

# Step 1: Create a request (frontend → backend)
cat > "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md" <<'EOF'
---
id: req-001-add-users-api
from: frontend
to: backend
scope: external
type: api-addition
priority: medium
status: pending
created: 2026-02-09T10:00:00Z
updated: 2026-02-09T10:00:00Z
related_contract: .accord/contracts/backend.yaml
---

## What

Need a GET /api/users endpoint to list users.

## Proposed Change

```yaml
GET /api/users
Response: { users: [User] }
```

## Why

Frontend dashboard needs to display user list.

## Impact

- New UsersController
- New User model
EOF

assert_file "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md" "Request created"
assert_validator "$ACCORD_DIR/protocol/scan/validators/validate-request.sh" \
    "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md" "Request validates"

# Step 2: Approve the request
sed 's/status: pending/status: approved/' \
    "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md" > "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md.tmp"
mv "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md.tmp" \
    "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md"

assert_contains "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md" \
    "status: approved" "Status changed to approved"

# Step 3: Mark in-progress
sed 's/status: approved/status: in-progress/' \
    "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md" > "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md.tmp"
mv "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md.tmp" \
    "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md"

assert_contains "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md" \
    "status: in-progress" "Status changed to in-progress"

# Step 4: Complete — update contract (add a real endpoint to make it pass validation)
cat > "$TEST6_DIR/.accord/contracts/backend.yaml" <<'EOF'
openapi: "3.0.3"
info:
  title: "backend API"
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
  /api/users:
    get:
      summary: "List users"
      responses:
        '200':
          description: "List of users"
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
                  properties:
                    id:
                      type: string
                    name:
                      type: string
EOF

assert_validator "$ACCORD_DIR/protocol/scan/validators/validate-openapi.sh" \
    "$TEST6_DIR/.accord/contracts/backend.yaml" "Updated contract validates"

# Step 5: Mark completed + archive
sed 's/status: in-progress/status: completed/' \
    "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md" > "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md.tmp"
mv "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md.tmp" \
    "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md"

mv "$TEST6_DIR/.accord/comms/inbox/backend/req-001-add-users-api.md" \
    "$TEST6_DIR/.accord/comms/archive/req-001-add-users-api.md"

assert_file "$TEST6_DIR/.accord/comms/archive/req-001-add-users-api.md" "Request archived"
assert_contains "$TEST6_DIR/.accord/comms/archive/req-001-add-users-api.md" \
    "status: completed" "Archived request has completed status"

# Verify inbox is now empty (except .gitkeep)
inbox_files=$(find "$TEST6_DIR/.accord/comms/inbox/backend" -name "*.md" -type f 2>/dev/null | wc -l | xargs)
if [[ "$inbox_files" -eq 0 ]]; then
    pass "Inbox cleared after archive"
else
    fail "Inbox still has $inbox_files request files"
fi

# ══════════════════════════════════════════════════════════════════════════════
# TEST 7: Example project passes doctor
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 7] Example project passes doctor${NC}"

if bash "$ACCORD_DIR/accord-doctor.sh" --project-dir "$ACCORD_DIR/examples/microservice-project" > /dev/null 2>&1; then
    pass "Example project passes all doctor checks"
else
    fail "Example project has doctor issues"
fi

# ══════════════════════════════════════════════════════════════════════════════
# TEST 8: Validator catches bad files
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 8] Validators catch errors${NC}"

# Bad OpenAPI (missing paths)
cat > "$TMPDIR/bad-openapi.yaml" <<'EOF'
openapi: "3.0.3"
info:
  title: "bad"
  version: "0.1.0"
EOF

if ! bash "$ACCORD_DIR/protocol/scan/validators/validate-openapi.sh" "$TMPDIR/bad-openapi.yaml" > /dev/null 2>&1; then
    pass "OpenAPI validator rejects missing paths"
else
    fail "OpenAPI validator should have rejected missing paths"
fi

# Bad internal contract (missing sections)
cat > "$TMPDIR/bad-internal.md" <<'EOF'
---
id: bad
module: bad
language: java
type: interface
status: draft
---

## Interface

Some text without code block.
EOF

if ! bash "$ACCORD_DIR/protocol/scan/validators/validate-internal.sh" "$TMPDIR/bad-internal.md" > /dev/null 2>&1; then
    pass "Internal validator rejects missing sections"
else
    fail "Internal validator should have rejected missing sections"
fi

# Bad request (missing fields)
cat > "$TMPDIR/bad-request.md" <<'EOF'
---
id: req-001-bad
from: alpha
---

## What

Incomplete request.
EOF

if ! bash "$ACCORD_DIR/protocol/scan/validators/validate-request.sh" "$TMPDIR/bad-request.md" > /dev/null 2>&1; then
    pass "Request validator rejects missing fields"
else
    fail "Request validator should have rejected missing fields"
fi

# ══════════════════════════════════════════════════════════════════════════════
# TEST 9: Multi-repo config
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 9] Multi-repo config${NC}"

TEST9_DIR="$TMPDIR/test9"
mkdir -p "$TEST9_DIR"

bash "$ACCORD_DIR/init.sh" \
    --project-name "test-multirepo" \
    --repo-model multi-repo \
    --teams "svc-a,svc-b" \
    --hub "git@github.com:org/accord-hub.git" \
    --adapter none \
    --target-dir "$TEST9_DIR" \
    --no-interactive > /dev/null 2>&1

assert_contains "$TEST9_DIR/.accord/config.yaml" "multi-repo" "Config has multi-repo model"
assert_contains "$TEST9_DIR/.accord/config.yaml" "git@github.com:org/accord-hub.git" "Config has hub URL"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 10: Sync mode — auto-poll creates watch script
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 10] Sync mode auto-poll${NC}"

TEST10_DIR="$TMPDIR/test10"
mkdir -p "$TEST10_DIR"

bash "$ACCORD_DIR/init.sh" \
    --project-name "test-poll" \
    --repo-model monorepo \
    --teams "alpha" \
    --adapter none \
    --sync-mode auto-poll \
    --target-dir "$TEST10_DIR" \
    --no-interactive > /dev/null 2>&1

assert_file "$TEST10_DIR/.accord/accord-watch.sh" "Watch script created for auto-poll"
assert_contains "$TEST10_DIR/.accord/config.yaml" "auto-poll" "Config has auto-poll sync mode"

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}=== Test Results ===${NC}"
echo -e "  Total: $TESTS, ${GREEN}Passed: $PASSED${NC}, ${RED}Failed: $FAILED${NC}"

if [[ "$KEEP" == true ]]; then
    echo -e "\n  Temp dir kept: $TMPDIR"
fi

if [[ $FAILED -gt 0 ]]; then
    exit 1
fi

echo -e "\n  ${GREEN}All tests passed!${NC}"
exit 0
