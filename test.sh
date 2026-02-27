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
    --services "alpha,beta" \
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

# accord-sync.sh copied to .accord/
assert_file "$TEST1_DIR/.accord/accord-sync.sh" "accord-sync.sh copied to .accord/"
if [[ -x "$TEST1_DIR/.accord/accord-sync.sh" ]]; then
    pass "accord-sync.sh is executable"
else
    fail "accord-sync.sh is not executable"
fi

# ══════════════════════════════════════════════════════════════════════════════
# TEST 2: Init with multiple services
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 2] Init with multiple services (no modules)${NC}"

TEST2_DIR="$TMPDIR/test2"
mkdir -p "$TEST2_DIR"

bash "$ACCORD_DIR/init.sh" \
    --project-name "test-multi" \
    --repo-model monorepo \
    --services "svc-a,svc-b" \
    --language java \
    --adapter none \
    --target-dir "$TEST2_DIR" \
    --no-interactive > /dev/null 2>&1

assert_file "$TEST2_DIR/.accord/config.yaml"                          "Config created"
assert_file "$TEST2_DIR/.accord/contracts/svc-a.yaml"                 "svc-a contract created"
assert_file "$TEST2_DIR/.accord/contracts/svc-b.yaml"                 "svc-b contract created"
assert_dir  "$TEST2_DIR/.accord/comms/inbox/svc-a"                    "svc-a inbox"
assert_dir  "$TEST2_DIR/.accord/comms/inbox/svc-b"                    "svc-b inbox"
assert_contains "$TEST2_DIR/.accord/config.yaml" "svc-a"              "Config lists svc-a"
assert_contains "$TEST2_DIR/.accord/config.yaml" "svc-b"              "Config lists svc-b"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 3: Idempotency — running init twice doesn't break things
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 3] Idempotency (early exit)${NC}"

# Run init.sh again on test2 — should exit early with "Already initialized"
reinit_output=$(bash "$ACCORD_DIR/init.sh" \
    --project-name "test-multi" \
    --repo-model monorepo \
    --services "svc-a,svc-b" \
    --language java \
    --adapter none \
    --target-dir "$TEST2_DIR" \
    --no-interactive 2>&1)

if echo "$reinit_output" | grep -q "Already initialized"; then
    pass "Second init exits with 'Already initialized' message"
else
    fail "Second init should show 'Already initialized' message"
fi

# Verify nothing changed
config_count=$(grep -c "svc-a" "$TEST2_DIR/.accord/config.yaml" 2>/dev/null || echo 0)
if [[ "$config_count" -le 2 ]]; then pass "Config not duplicated"; else fail "Config duplicated"; fi

assert_file "$TEST2_DIR/.accord/contracts/svc-a.yaml" "Contracts still exist after re-run"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 4: Claude Code adapter installation
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 4] Claude Code adapter${NC}"

TEST4_DIR="$TMPDIR/test4"
mkdir -p "$TEST4_DIR"

bash "$ACCORD_DIR/init.sh" \
    --project-name "test-adapter" \
    --repo-model monorepo \
    --services "svc-a,svc-b" \
    --adapter claude-code \
    --target-dir "$TEST4_DIR" \
    --no-interactive > /dev/null 2>&1

assert_file "$TEST4_DIR/CLAUDE.md"                                 "CLAUDE.md created"
assert_file "$TEST4_DIR/.claude/commands/accord-check-inbox.md"           "accord-check-inbox command installed"
assert_file "$TEST4_DIR/.claude/commands/accord-send-request.md"          "accord-send-request command installed"
assert_file "$TEST4_DIR/.claude/commands/accord-complete-request.md"      "accord-complete-request command installed"
assert_file "$TEST4_DIR/.claude/commands/accord-scan.md"           "accord-scan command installed"
assert_file "$TEST4_DIR/.claude/commands/accord-init.md"           "accord-init command installed"
assert_file "$TEST4_DIR/.claude/skills/contract-scanner/SKILL.md"  "Scanner skill installed"

# Check variable substitution
assert_contains "$TEST4_DIR/CLAUDE.md" "test-adapter"    "CLAUDE.md has project name"
assert_contains "$TEST4_DIR/CLAUDE.md" "svc-a"          "CLAUDE.md has service name"
assert_not_contains "$TEST4_DIR/CLAUDE.md" "{{PROJECT_NAME}}" "No unresolved vars in CLAUDE.md"
assert_contains "$TEST4_DIR/CLAUDE.md" "ACCORD START"    "Has ACCORD START marker"
assert_contains "$TEST4_DIR/CLAUDE.md" "ACCORD END"      "Has ACCORD END marker"

# Check hub-centric paths in CLAUDE.md
assert_contains "$TEST4_DIR/CLAUDE.md" "contracts/" "CLAUDE.md references contracts"
assert_contains "$TEST4_DIR/CLAUDE.md" "comms/"     "CLAUDE.md references comms"

# Idempotency — run install again
bash "$ACCORD_DIR/adapters/claude-code/install.sh" \
    --project-dir "$TEST4_DIR" \
    --project-name "test-adapter" \
    --service-name "svc-a" \
    --service-list "svc-a,svc-b" > /dev/null 2>&1

accord_blocks=$(grep -c "ACCORD START" "$TEST4_DIR/CLAUDE.md" 2>/dev/null || echo 0)
if [[ "$accord_blocks" -eq 1 ]]; then
    pass "Adapter idempotent (1 ACCORD block after re-install)"
else
    fail "Adapter not idempotent ($accord_blocks ACCORD blocks)"
fi

# Check all command files present
assert_file "$TEST4_DIR/.claude/commands/accord-dispatch.md"          "accord-dispatch command installed"
assert_file "$TEST4_DIR/.claude/commands/accord-status.md"            "accord-status command installed"
assert_file "$TEST4_DIR/.claude/commands/accord-validate.md"          "accord-validate command installed"

# Check no unresolved template variables in command files
unresolved_cmds=0
for cmd_file in "$TEST4_DIR"/.claude/commands/accord-*.md; do
    if grep -q '{{' "$cmd_file" 2>/dev/null; then
        unresolved_cmds=$((unresolved_cmds + 1))
    fi
done
if [[ "$unresolved_cmds" -eq 0 ]]; then
    pass "No unresolved {{VAR}} in command files"
else
    fail "$unresolved_cmds command file(s) have unresolved {{VAR}}"
fi

# Check command headings match filenames (# /accord-{name})
heading_ok=true
for cmd_file in "$TEST4_DIR"/.claude/commands/accord-*.md; do
    fname="$(basename "$cmd_file" .md)"
    expected_heading="# /$fname"
    actual_heading="$(head -1 "$cmd_file")"
    if [[ "$actual_heading" != "$expected_heading" ]]; then
        heading_ok=false
        fail "Heading mismatch in $fname: expected '$expected_heading', got '$actual_heading'"
    fi
done
if [[ "$heading_ok" == true ]]; then
    pass "All command headings match filenames"
fi

# Check old command files cleaned up on upgrade
touch "$TEST4_DIR/.claude/commands/check-inbox.md"
touch "$TEST4_DIR/.claude/commands/send-request.md"
touch "$TEST4_DIR/.claude/commands/complete-request.md"

bash "$ACCORD_DIR/adapters/claude-code/install.sh" \
    --project-dir "$TEST4_DIR" \
    --project-name "test-adapter" \
    --service-list "svc-a,svc-b" > /dev/null 2>&1

if [[ ! -f "$TEST4_DIR/.claude/commands/check-inbox.md" && \
      ! -f "$TEST4_DIR/.claude/commands/send-request.md" && \
      ! -f "$TEST4_DIR/.claude/commands/complete-request.md" ]]; then
    pass "Old command files cleaned up on re-install"
else
    fail "Old command files still present after re-install"
fi

# Hook script installed
assert_file "$TEST4_DIR/.accord/hooks/accord-auto-sync.sh" "Hook script installed"
if [[ -x "$TEST4_DIR/.accord/hooks/accord-auto-sync.sh" ]]; then
    pass "Hook script is executable"
else
    fail "Hook script is not executable"
fi

# .claude/settings.json created with hooks (default sync mode is on-action)
assert_file "$TEST4_DIR/.claude/settings.json" "settings.json created"
assert_contains "$TEST4_DIR/.claude/settings.json" "SessionStart" "settings.json has SessionStart hook"

# Claude Code adapter with auto-poll: settings.json has both SessionStart and Stop hooks
TEST4_POLL_DIR="$TMPDIR/test4-poll"
mkdir -p "$TEST4_POLL_DIR"
bash "$ACCORD_DIR/init.sh" \
    --project-name "test-adapter-poll" \
    --repo-model monorepo \
    --services "svc-a,svc-b" \
    --adapter claude-code \
    --sync-mode auto-poll \
    --target-dir "$TEST4_POLL_DIR" \
    --no-interactive > /dev/null 2>&1

assert_contains "$TEST4_POLL_DIR/.claude/settings.json" "SessionStart" "auto-poll settings.json has SessionStart hook"
assert_contains "$TEST4_POLL_DIR/.claude/settings.json" "Stop" "auto-poll settings.json has Stop hook"

# No accord-watch.sh generated for claude-code adapter
if [[ ! -f "$TEST4_POLL_DIR/.accord/accord-watch.sh" ]]; then
    pass "No accord-watch.sh for claude-code adapter (hooks replace it)"
else
    fail "accord-watch.sh should not be generated for claude-code adapter"
fi

# Existing settings.json content preserved during merge
TEST4_MERGE_DIR="$TMPDIR/test4-merge"
mkdir -p "$TEST4_MERGE_DIR/.claude"
echo '{"customSetting": true}' > "$TEST4_MERGE_DIR/.claude/settings.json"
bash "$ACCORD_DIR/init.sh" \
    --project-name "test-adapter-merge" \
    --repo-model monorepo \
    --services "svc-a" \
    --adapter claude-code \
    --target-dir "$TEST4_MERGE_DIR" \
    --no-interactive > /dev/null 2>&1

assert_contains "$TEST4_MERGE_DIR/.claude/settings.json" "customSetting" "Existing settings.json content preserved"
assert_contains "$TEST4_MERGE_DIR/.claude/settings.json" "hooks" "Hooks merged into existing settings.json"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 5: Generic adapter installation
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 5] Generic adapter${NC}"

TEST5_DIR="$TMPDIR/test5"
mkdir -p "$TEST5_DIR"

bash "$ACCORD_DIR/init.sh" \
    --project-name "test-generic" \
    --repo-model monorepo \
    --services "alpha,beta" \
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
    --services "frontend,backend" \
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
# TEST 9: Multi-repo config + auto hub sync on init
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 9] Multi-repo auto hub sync on init${NC}"

# 9a. Config-only test (unreachable hub URL — graceful degradation)
TEST9_DIR="$TMPDIR/test9"
mkdir -p "$TEST9_DIR"

bash "$ACCORD_DIR/init.sh" \
    --project-name "test-multirepo" \
    --repo-model multi-repo \
    --services "svc-a,svc-b" \
    --hub "git@github.com:org/accord-hub.git" \
    --adapter none \
    --target-dir "$TEST9_DIR" \
    --no-interactive > /dev/null 2>&1

assert_contains "$TEST9_DIR/.accord/config.yaml" "multi-repo" "Config has multi-repo model"
assert_contains "$TEST9_DIR/.accord/config.yaml" "git@github.com:org/accord-hub.git" "Config has hub URL"

# Multi-repo: only own service contract created (not svc-b)
assert_file "$TEST9_DIR/.accord/contracts/svc-a.yaml" "Own service contract created"
if [[ ! -f "$TEST9_DIR/.accord/contracts/svc-b.yaml" ]]; then
    pass "Other service contract NOT created (will come from hub)"
else
    fail "Other service contract should not be created in multi-repo"
fi

# 9b. Full auto-sync lifecycle with local bare hub
TEST9_HUB="$TMPDIR/test9-hub.git"
git init --bare "$TEST9_HUB" > /dev/null 2>&1

# Create svc-a repo — init should auto-clone hub + push contract + notify
TEST9_SVCA="$TMPDIR/test9-svc-a"
mkdir -p "$TEST9_SVCA"
(cd "$TEST9_SVCA" && git init > /dev/null 2>&1 && git config user.email "test@accord.dev" && git config user.name "Accord Test")
bash "$ACCORD_DIR/init.sh" \
    --project-name "test-multirepo" \
    --repo-model multi-repo \
    --services "svc-a,svc-b" \
    --hub "$TEST9_HUB" \
    --adapter none \
    --target-dir "$TEST9_SVCA" \
    --no-interactive > /dev/null 2>&1

# Verify auto-clone
assert_dir "$TEST9_SVCA/.accord/hub/.git" "Init auto-clones hub"

# Own contract pushed to hub (even if template — other services need to see it)
assert_file "$TEST9_SVCA/.accord/hub/contracts/svc-a.yaml" "Own contract pushed to hub on init"

# Verify service-joined notification in svc-b's inbox on hub
assert_file "$TEST9_SVCA/.accord/hub/comms/inbox/svc-b/req-000-service-joined-svc-a.md" \
    "Service-joined notification created for svc-b"
assert_contains "$TEST9_SVCA/.accord/hub/comms/inbox/svc-b/req-000-service-joined-svc-a.md" \
    "status: pending" "Notification has pending status"
assert_contains "$TEST9_SVCA/.accord/hub/comms/inbox/svc-b/req-000-service-joined-svc-a.md" \
    "type: other" "Notification has type other"

# Validate notification passes request validator
assert_validator "$ACCORD_DIR/protocol/scan/validators/validate-request.sh" \
    "$TEST9_SVCA/.accord/hub/comms/inbox/svc-b/req-000-service-joined-svc-a.md" \
    "Service-joined notification validates"

# Create svc-b repo — should auto-pull svc-a's contract from hub
TEST9_SVCB="$TMPDIR/test9-svc-b"
mkdir -p "$TEST9_SVCB"
(cd "$TEST9_SVCB" && git init > /dev/null 2>&1 && git config user.email "test@accord.dev" && git config user.name "Accord Test")
bash "$ACCORD_DIR/init.sh" \
    --project-name "test-multirepo" \
    --repo-model multi-repo \
    --services "svc-b,svc-a" \
    --hub "$TEST9_HUB" \
    --adapter none \
    --target-dir "$TEST9_SVCB" \
    --no-interactive > /dev/null 2>&1

# svc-b's own contract pushed to hub
assert_file "$TEST9_SVCB/.accord/hub/contracts/svc-b.yaml" "svc-b contract pushed to hub on init"

# svc-b pulled svc-a's contract from hub
assert_file "$TEST9_SVCB/.accord/contracts/svc-a.yaml" "svc-b pulled svc-a's contract from hub"

# Manual push/pull still works after auto-sync
(cd "$TEST9_SVCA" && git add -A && git commit -m "init" > /dev/null 2>&1) || true

# svc-a creates a request for svc-b and pushes manually
mkdir -p "$TEST9_SVCA/.accord/comms/inbox/svc-b"
cat > "$TEST9_SVCA/.accord/comms/inbox/svc-b/req-001-test-sync.md" <<'EOF'
---
id: req-001-test-sync
from: svc-a
to: svc-b
scope: external
type: api-addition
priority: medium
status: pending
created: 2026-02-10T10:00:00Z
updated: 2026-02-10T10:00:00Z
related_contract: .accord/contracts/svc-b.yaml
---

## What

Test sync request.

## Proposed Change

```yaml
GET /api/test
```

## Why

Testing multi-repo sync.

## Impact

None.
EOF

bash "$ACCORD_DIR/accord-sync.sh" push --target-dir "$TEST9_SVCA" --service-name svc-a > /dev/null 2>&1

# svc-b pulls and receives the request
bash "$ACCORD_DIR/accord-sync.sh" pull --target-dir "$TEST9_SVCB" --service-name svc-b > /dev/null 2>&1
assert_file "$TEST9_SVCB/.accord/comms/inbox/svc-b/req-001-test-sync.md" "Sync: request delivered via hub"
assert_contains "$TEST9_SVCB/.accord/comms/inbox/svc-b/req-001-test-sync.md" "status: pending" "Sync: request has correct status"

# 9c. Archive-aware pull: completed requests don't re-appear after pull
# svc-b completes the request → moves to archive → pushes
mkdir -p "$TEST9_SVCB/.accord/comms/archive"
cp "$TEST9_SVCB/.accord/comms/inbox/svc-b/req-001-test-sync.md" "$TEST9_SVCB/.accord/comms/archive/req-001-test-sync.md"
# Update status to completed in archive copy
sed 's/status: pending/status: completed/' \
    "$TEST9_SVCB/.accord/comms/archive/req-001-test-sync.md" \
    > "$TEST9_SVCB/.accord/comms/archive/req-001-test-sync.md.tmp" \
    && mv "$TEST9_SVCB/.accord/comms/archive/req-001-test-sync.md.tmp" \
          "$TEST9_SVCB/.accord/comms/archive/req-001-test-sync.md"
# Remove from inbox (as agent would do)
rm "$TEST9_SVCB/.accord/comms/inbox/svc-b/req-001-test-sync.md"

# Push archive to hub (should also clean up stale hub inbox copy)
bash "$ACCORD_DIR/accord-sync.sh" push --target-dir "$TEST9_SVCB" --service-name svc-b > /dev/null 2>&1

# Verify: archived request removed from hub inbox
if [[ ! -f "$TEST9_SVCB/.accord/hub/comms/inbox/svc-b/req-001-test-sync.md" ]]; then
    pass "Push cleans up archived request from hub inbox"
else
    fail "Stale request still in hub inbox after push"
fi

# Verify: archive copy exists in hub
assert_file "$TEST9_SVCB/.accord/hub/comms/archive/req-001-test-sync.md" "Archived request pushed to hub archive"

# Now pull again — archived request must NOT re-appear in local inbox
bash "$ACCORD_DIR/accord-sync.sh" pull --target-dir "$TEST9_SVCB" --service-name svc-b > /dev/null 2>&1
if [[ ! -f "$TEST9_SVCB/.accord/comms/inbox/svc-b/req-001-test-sync.md" ]]; then
    pass "Pull skips archived request (no re-appear)"
else
    fail "Archived request re-appeared in inbox after pull"
fi

# ══════════════════════════════════════════════════════════════════════════════
# TEST 10: Sync mode — auto-poll creates watch script
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 10] Sync mode auto-poll${NC}"

TEST10_DIR="$TMPDIR/test10"
mkdir -p "$TEST10_DIR"

bash "$ACCORD_DIR/init.sh" \
    --project-name "test-poll" \
    --repo-model monorepo \
    --services "alpha" \
    --adapter none \
    --sync-mode auto-poll \
    --target-dir "$TEST10_DIR" \
    --no-interactive > /dev/null 2>&1

assert_file "$TEST10_DIR/.accord/accord-watch.sh" "Watch script created for auto-poll (non-claude adapter)"
assert_contains "$TEST10_DIR/.accord/config.yaml" "auto-poll" "Config has auto-poll sync mode"

# .accord/.gitignore created with .last-sync-pull
assert_file "$TEST10_DIR/.accord/.gitignore" ".accord/.gitignore created"
assert_contains "$TEST10_DIR/.accord/.gitignore" ".last-sync-pull" ".gitignore excludes .last-sync-pull"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 11: Debug logging setup
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 11] Debug logging setup${NC}"

TEST11_DIR="$TMPDIR/test11"
mkdir -p "$TEST11_DIR"

bash "$ACCORD_DIR/init.sh" \
    --project-name "test-debug" \
    --repo-model monorepo \
    --services "alpha,beta" \
    --adapter none \
    --target-dir "$TEST11_DIR" \
    --no-interactive > /dev/null 2>&1

# Log directory created
assert_dir "$TEST11_DIR/.accord/log" "Log directory created"

# .gitignore excludes JSONL files
assert_file "$TEST11_DIR/.accord/log/.gitignore" "Log .gitignore created"
assert_contains "$TEST11_DIR/.accord/log/.gitignore" "*.jsonl" ".gitignore excludes JSONL"

# Config has debug setting
assert_contains "$TEST11_DIR/.accord/config.yaml" "debug: false" "Config has debug setting"

# JSONL format validation — write a sample log entry and validate it
SAMPLE_LOG="$TEST11_DIR/.accord/log/2026-02-10T14-30-00_alpha.jsonl"
cat > "$SAMPLE_LOG" <<'EOF'
{"ts":"2026-02-10T14:30:00Z","session":"2026-02-10T14-30-00_alpha","module":"alpha","action":"session_start","category":"lifecycle","detail":"Session started for module alpha"}
{"ts":"2026-02-10T14:30:01Z","session":"2026-02-10T14-30-00_alpha","module":"alpha","action":"config_read","category":"lifecycle","detail":"Read .accord/config.yaml"}
{"ts":"2026-02-10T14:30:02Z","session":"2026-02-10T14-30-00_alpha","module":"alpha","action":"inbox_check","category":"comms","detail":"Found 0 pending requests","files":[]}
{"ts":"2026-02-10T14:30:10Z","session":"2026-02-10T14-30-00_alpha","module":"alpha","action":"request_create","category":"comms","detail":"Created request req-001-test","request_id":"req-001-test","files":[".accord/comms/inbox/beta/req-001-test.md"]}
{"ts":"2026-02-10T14:31:00Z","session":"2026-02-10T14-30-00_alpha","module":"alpha","action":"request_start","category":"comms","detail":"Started work on req-002","request_id":"req-002","status_from":"approved","status_to":"in-progress"}
EOF

# Validate each line is valid JSON with required fields
jsonl_valid=true
line_num=0
while IFS= read -r line; do
    line_num=$((line_num + 1))
    [[ -z "$line" ]] && continue

    # Check it's valid JSON (python available on macOS/Linux)
    if ! echo "$line" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
        jsonl_valid=false
        fail "JSONL line $line_num is not valid JSON"
        break
    fi

    # Check required fields
    for field in ts session module action category detail; do
        if ! echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$field' in d" 2>/dev/null; then
            jsonl_valid=false
            fail "JSONL line $line_num missing required field: $field"
            break 2
        fi
    done
done < "$SAMPLE_LOG"

if [[ "$jsonl_valid" == true ]]; then
    pass "JSONL log entries are valid (5 entries, all required fields present)"
fi

# Validate category values
categories_valid=true
while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    cat_val=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin)['category'])" 2>/dev/null)
    case "$cat_val" in
        lifecycle|comms|contract|git|scan|config) ;;
        *) categories_valid=false; break ;;
    esac
done < "$SAMPLE_LOG"

if [[ "$categories_valid" == true ]]; then
    pass "All log entry categories are valid"
else
    fail "Invalid category found in log entries"
fi

# Validate state transition entries have status_from and status_to
transition_entry=$(grep "status_from" "$SAMPLE_LOG" | head -1)
if echo "$transition_entry" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status_from']=='approved' and d['status_to']=='in-progress'" 2>/dev/null; then
    pass "State transition entry has valid status_from/status_to"
else
    fail "State transition entry missing or invalid status_from/status_to"
fi

# Verify .gitignore actually excludes the JSONL (log file should not be gitignored by itself, but would be by .accord/log/.gitignore)
# Just verify the .gitignore content is correct
if grep -q '^\*\.jsonl$' "$TEST11_DIR/.accord/log/.gitignore" 2>/dev/null; then
    pass ".gitignore pattern correctly excludes JSONL files"
else
    fail ".gitignore pattern incorrect"
fi

# Clean up sample log (it would be gitignored anyway)
rm -f "$SAMPLE_LOG"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 12: Init --force re-initializes but protects existing contracts
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 12] Init --force re-initializes${NC}"

TEST12_DIR="$TMPDIR/test12"
mkdir -p "$TEST12_DIR"

# First init
bash "$ACCORD_DIR/init.sh" \
    --project-name "test-force" \
    --repo-model monorepo \
    --services "alpha,beta" \
    --adapter none \
    --target-dir "$TEST12_DIR" \
    --no-interactive > /dev/null 2>&1

# Modify the alpha contract (simulate real usage)
cat > "$TEST12_DIR/.accord/contracts/alpha.yaml" <<'EOF'
openapi: "3.0.3"
info:
  title: "alpha API"
  version: "0.1.0"
  x-accord-status: stable
paths:
  /api/custom:
    get:
      summary: "Custom endpoint"
      responses:
        '200':
          description: "OK"
EOF

# Re-init with --force
bash "$ACCORD_DIR/init.sh" \
    --project-name "test-force" \
    --repo-model monorepo \
    --services "alpha,beta" \
    --adapter none \
    --target-dir "$TEST12_DIR" \
    --force \
    --no-interactive > /dev/null 2>&1

# Contract should NOT be overwritten (file-exists check protects it)
assert_contains "$TEST12_DIR/.accord/contracts/alpha.yaml" "/api/custom" \
    "Contract preserved after --force re-init"
assert_file "$TEST12_DIR/.accord/config.yaml" "Config still exists after --force"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 13: Registry generation
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 13] Registry generation${NC}"

TEST13_DIR="$TMPDIR/test13"
mkdir -p "$TEST13_DIR"

bash "$ACCORD_DIR/init.sh" \
    --project-name "test-registry" \
    --repo-model monorepo \
    --services "svc-a,svc-b" \
    --language java \
    --adapter none \
    --target-dir "$TEST13_DIR" \
    --no-interactive > /dev/null 2>&1

# Registry files created for services
assert_file "$TEST13_DIR/.accord/registry/svc-a.md" "svc-a registry created"
assert_file "$TEST13_DIR/.accord/registry/svc-b.md" "svc-b registry created"

# Registry has correct content
assert_contains "$TEST13_DIR/.accord/registry/svc-a.md" "name: svc-a" "svc-a registry has name"
assert_contains "$TEST13_DIR/.accord/registry/svc-a.md" "type: service" "svc-a registry has type service"
assert_contains "$TEST13_DIR/.accord/registry/svc-b.md" "language: java" "svc-b registry has language"

# No unresolved template variables
unresolved_reg=0
for reg_file in "$TEST13_DIR"/.accord/registry/*.md; do
    if grep -q '{{' "$reg_file" 2>/dev/null; then
        unresolved_reg=$((unresolved_reg + 1))
    fi
done
if [[ "$unresolved_reg" -eq 0 ]]; then
    pass "No unresolved {{VAR}} in registry files"
else
    fail "$unresolved_reg registry file(s) have unresolved {{VAR}}"
fi

# ══════════════════════════════════════════════════════════════════════════════
# TEST 14: Template protection on hub sync
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 14] Template protection on hub sync${NC}"

# Create a hub with a real contract
TEST14_HUB="$TMPDIR/test14-hub.git"
git init --bare "$TEST14_HUB" > /dev/null 2>&1

TEST14_SVC="$TMPDIR/test14-svc"
mkdir -p "$TEST14_SVC"
(cd "$TEST14_SVC" && git init > /dev/null 2>&1 && git config user.email "test@accord.dev" && git config user.name "Accord Test")
bash "$ACCORD_DIR/init.sh" \
    --project-name "test-templateprot" \
    --repo-model multi-repo \
    --services "svc-a,svc-b" \
    --hub "$TEST14_HUB" \
    --adapter none \
    --target-dir "$TEST14_SVC" \
    --no-interactive > /dev/null 2>&1

# svc-a's contract pushed to hub on init (even if template — visibility first)
assert_file "$TEST14_SVC/.accord/hub/contracts/svc-a.yaml" "Own contract pushed to hub on init"

# Now simulate svc-b having a real contract on hub and verify it's NOT overwritten by a template
# Write a real contract to hub
TEST14_CLONE="$TMPDIR/test14-clone"
git clone "$TEST14_HUB" "$TEST14_CLONE" > /dev/null 2>&1
(cd "$TEST14_CLONE" && git config user.email "test@accord.dev" && git config user.name "Accord Test")
mkdir -p "$TEST14_CLONE/contracts"
cat > "$TEST14_CLONE/contracts/svc-b.yaml" <<'EOF'
openapi: "3.0.3"
info:
  title: "svc-b API"
  version: "0.1.0"
  x-accord-status: stable
paths:
  /api/real-endpoint:
    get:
      summary: "Real endpoint from svc-b"
      responses:
        '200':
          description: "OK"
EOF
(cd "$TEST14_CLONE" && git add -A && git commit -m "add svc-b contract" && git push) > /dev/null 2>&1

# Re-init svc-a (with --force) — should pull svc-b's real contract, not overwrite with template
TEST14_SVC2="$TMPDIR/test14-svc2"
mkdir -p "$TEST14_SVC2"
(cd "$TEST14_SVC2" && git init > /dev/null 2>&1 && git config user.email "test@accord.dev" && git config user.name "Accord Test")
bash "$ACCORD_DIR/init.sh" \
    --project-name "test-templateprot" \
    --repo-model multi-repo \
    --services "svc-a,svc-b" \
    --hub "$TEST14_HUB" \
    --adapter none \
    --target-dir "$TEST14_SVC2" \
    --no-interactive > /dev/null 2>&1

# svc-b's real contract should have been pulled from hub
assert_file "$TEST14_SVC2/.accord/contracts/svc-b.yaml" "svc-b contract pulled from hub"
assert_contains "$TEST14_SVC2/.accord/contracts/svc-b.yaml" "/api/real-endpoint" \
    "svc-b contract has real endpoint (not template)"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 15: Push retry on conflict
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 15] Push retry on conflict${NC}"

# Create hub
TEST15_HUB="$TMPDIR/test15-hub.git"
git init --bare "$TEST15_HUB" > /dev/null 2>&1

# Init svc-a
TEST15_SVCA="$TMPDIR/test15-svc-a"
mkdir -p "$TEST15_SVCA"
(cd "$TEST15_SVCA" && git init > /dev/null 2>&1 && git config user.email "test@accord.dev" && git config user.name "Accord Test")
bash "$ACCORD_DIR/init.sh" \
    --project-name "test-retry" \
    --repo-model multi-repo \
    --services "svc-a,svc-b" \
    --hub "$TEST15_HUB" \
    --adapter none \
    --target-dir "$TEST15_SVCA" \
    --no-interactive > /dev/null 2>&1

# Make a conflicting commit in hub directly (simulate another service pushing)
TEST15_CLONE="$TMPDIR/test15-clone"
git clone "$TEST15_HUB" "$TEST15_CLONE" > /dev/null 2>&1
(cd "$TEST15_CLONE" && git config user.email "test@accord.dev" && git config user.name "Accord Test")
mkdir -p "$TEST15_CLONE/contracts"
echo "# concurrent change" > "$TEST15_CLONE/contracts/concurrent.txt"
(cd "$TEST15_CLONE" && git add -A && git commit -m "concurrent change" && git push) > /dev/null 2>&1

# svc-a creates a request and pushes — should auto-retry with rebase
mkdir -p "$TEST15_SVCA/.accord/comms/inbox/svc-b"
cat > "$TEST15_SVCA/.accord/comms/inbox/svc-b/req-001-retry-test.md" <<'EOF'
---
id: req-001-retry-test
from: svc-a
to: svc-b
scope: external
type: api-addition
priority: low
status: pending
created: 2026-02-10T12:00:00Z
updated: 2026-02-10T12:00:00Z
---

## What

Test push retry.

## Proposed Change

None.

## Why

Testing.

## Impact

None.
EOF

if bash "$ACCORD_DIR/accord-sync.sh" push --target-dir "$TEST15_SVCA" --service-name svc-a > /dev/null 2>&1; then
    pass "Push with retry succeeded despite concurrent change"
else
    fail "Push with retry failed"
fi

# ══════════════════════════════════════════════════════════════════════════════
# TEST 16: Example project registry files exist
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 16] Example project registry files${NC}"

EXAMPLE_DIR="$ACCORD_DIR/examples/microservice-project"
assert_dir "$EXAMPLE_DIR/.accord/registry" "Example project has registry dir"
assert_file "$EXAMPLE_DIR/.accord/registry/frontend.md" "frontend registry exists"
assert_file "$EXAMPLE_DIR/.accord/registry/demo-engine.md" "demo-engine registry exists"
assert_file "$EXAMPLE_DIR/.accord/registry/device-manager.md" "device-manager registry exists"
assert_file "$EXAMPLE_DIR/.accord/registry/demo-admin.md" "demo-admin registry exists"

# Registry files have proper content
assert_contains "$EXAMPLE_DIR/.accord/registry/frontend.md" "type: service" "frontend registry has type"
assert_contains "$EXAMPLE_DIR/.accord/registry/device-manager.md" "## Owns" "device-manager has Owns section"
assert_contains "$EXAMPLE_DIR/.accord/registry/demo-admin.md" "## Does NOT Own" "demo-admin has Does NOT Own section"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 17: Orchestrator init (v2)
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 17] Orchestrator init (v2)${NC}"

TEST17_DIR="$TMPDIR/test17"
mkdir -p "$TEST17_DIR"

bash "$ACCORD_DIR/init.sh" \
    --role orchestrator \
    --project-name "test-hub" \
    --services "frontend,demo-engine,device-manager" \
    --adapter none \
    --target-dir "$TEST17_DIR" \
    --no-interactive > /dev/null 2>&1

# Flat structure (no .accord/ prefix)
assert_file "$TEST17_DIR/config.yaml"                         "Orchestrator config.yaml (flat)"
assert_dir  "$TEST17_DIR/directives"                          "Directives directory created"
assert_dir  "$TEST17_DIR/registry"                            "Registry directory created"
assert_dir  "$TEST17_DIR/contracts"                           "Contracts directory created"
assert_dir  "$TEST17_DIR/comms/inbox/orchestrator"            "Orchestrator inbox created"
assert_dir  "$TEST17_DIR/comms/inbox/frontend"                "Service inbox: frontend"
assert_dir  "$TEST17_DIR/comms/inbox/demo-engine"             "Service inbox: demo-engine"
assert_dir  "$TEST17_DIR/comms/inbox/device-manager"          "Service inbox: device-manager"
assert_dir  "$TEST17_DIR/comms/archive"                       "Archive directory created"
assert_dir  "$TEST17_DIR/comms/history"                       "History directory created"
assert_file "$TEST17_DIR/comms/PROTOCOL.md"                   "Comms PROTOCOL.md created"
assert_file "$TEST17_DIR/comms/TEMPLATE.md"                   "Comms TEMPLATE.md created"

# Config content
assert_contains "$TEST17_DIR/config.yaml" "role: orchestrator"  "Config has role: orchestrator"
assert_contains "$TEST17_DIR/config.yaml" 'version: "0.2"'     "Config has version 0.2"
assert_contains "$TEST17_DIR/config.yaml" "history_enabled: true" "Config has history_enabled"
assert_contains "$TEST17_DIR/config.yaml" "frontend"            "Config lists frontend service"
assert_contains "$TEST17_DIR/config.yaml" "demo-engine"         "Config lists demo-engine service"

# Protocol helpers copied
assert_file "$TEST17_DIR/protocol/history/write-history.sh"     "write-history.sh copied to hub"
assert_file "$TEST17_DIR/protocol/templates/directive.md.template" "Directive template copied to hub"

# Idempotency
reinit_orch_output=$(bash "$ACCORD_DIR/init.sh" \
    --role orchestrator \
    --project-name "test-hub" \
    --services "frontend,demo-engine,device-manager" \
    --adapter none \
    --target-dir "$TEST17_DIR" \
    --no-interactive 2>&1)

if echo "$reinit_orch_output" | grep -q "Already initialized"; then
    pass "Orchestrator re-init exits with 'Already initialized'"
else
    fail "Orchestrator re-init should show 'Already initialized'"
fi

# ══════════════════════════════════════════════════════════════════════════════
# TEST 18: Orchestrator with Claude Code adapter (v2)
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 18] Orchestrator Claude Code adapter (v2)${NC}"

TEST18_DIR="$TMPDIR/test18"
mkdir -p "$TEST18_DIR"

bash "$ACCORD_DIR/init.sh" \
    --role orchestrator \
    --project-name "test-orch-adapter" \
    --services "svc-a,svc-b,svc-c" \
    --adapter claude-code \
    --target-dir "$TEST18_DIR" \
    --no-interactive > /dev/null 2>&1

assert_file "$TEST18_DIR/CLAUDE.md"                                     "Orchestrator CLAUDE.md created"
assert_file "$TEST18_DIR/.claude/commands/accord-decompose.md"          "accord-decompose command installed"
assert_file "$TEST18_DIR/.claude/commands/accord-route.md"              "accord-route command installed"
assert_file "$TEST18_DIR/.claude/commands/accord-monitor.md"            "accord-monitor command installed"
assert_file "$TEST18_DIR/.claude/commands/accord-check-inbox.md"        "accord-check-inbox command installed"

# Check variable substitution
assert_contains "$TEST18_DIR/CLAUDE.md" "test-orch-adapter"    "CLAUDE.md has project name"
assert_contains "$TEST18_DIR/CLAUDE.md" "svc-a"               "CLAUDE.md has service name"
assert_not_contains "$TEST18_DIR/CLAUDE.md" "{{PROJECT_NAME}}" "No unresolved vars in CLAUDE.md"
assert_contains "$TEST18_DIR/CLAUDE.md" "ACCORD START"          "Has ACCORD START marker"
assert_contains "$TEST18_DIR/CLAUDE.md" "orchestrator"          "CLAUDE.md mentions orchestrator role"

# No unresolved template variables in command files
unresolved_orch_cmds=0
for cmd_file in "$TEST18_DIR"/.claude/commands/accord-*.md; do
    if grep -q '{{' "$cmd_file" 2>/dev/null; then
        unresolved_orch_cmds=$((unresolved_orch_cmds + 1))
    fi
done
if [[ "$unresolved_orch_cmds" -eq 0 ]]; then
    pass "No unresolved {{VAR}} in orchestrator command files"
else
    fail "$unresolved_orch_cmds orchestrator command file(s) have unresolved {{VAR}}"
fi

# ══════════════════════════════════════════════════════════════════════════════
# TEST 19: Directive template and validator (v2)
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 19] Directive template and validator (v2)${NC}"

# Create a valid directive from template
DIRECTIVE_FILE="$TMPDIR/test-directive.md"
cp "$ACCORD_DIR/protocol/templates/directive.md.template" "$DIRECTIVE_FILE"
sed 's/{{DIRECTIVE_NUMBER}}/001/g; s/{{SHORT_DESCRIPTION}}/test-feature/g; s/{{TITLE}}/Test Feature/g; s/{{PRIORITY}}/high/g; s/{{CREATED_TIMESTAMP}}/2026-02-11T10:00:00Z/g; s/{{REQUIREMENT}}/Need a test feature./g; s/{{ACCEPTANCE_CRITERIA}}/Feature works./g' \
    "$DIRECTIVE_FILE" > "$DIRECTIVE_FILE.tmp" && mv "$DIRECTIVE_FILE.tmp" "$DIRECTIVE_FILE"

assert_validator "$ACCORD_DIR/protocol/scan/validators/validate-directive.sh" \
    "$DIRECTIVE_FILE" "Valid directive passes validation"

# Test with invalid status
DIRECTIVE_BAD="$TMPDIR/test-directive-bad.md"
cat > "$DIRECTIVE_BAD" <<'EOF'
---
id: dir-002-bad
title: Bad Directive
priority: high
status: invalid-status
created: 2026-02-11T10:00:00Z
updated: 2026-02-11T10:00:00Z
requests: []
---

## Requirement

Something.
EOF

if ! bash "$ACCORD_DIR/protocol/scan/validators/validate-directive.sh" "$DIRECTIVE_BAD" > /dev/null 2>&1; then
    pass "Directive validator rejects invalid status"
else
    fail "Directive validator should have rejected invalid status"
fi

# Test missing required fields
DIRECTIVE_MISSING="$TMPDIR/test-directive-missing.md"
cat > "$DIRECTIVE_MISSING" <<'EOF'
---
id: dir-003-missing
title: Missing Fields
---

## Requirement

Something.
EOF

if ! bash "$ACCORD_DIR/protocol/scan/validators/validate-directive.sh" "$DIRECTIVE_MISSING" > /dev/null 2>&1; then
    pass "Directive validator rejects missing fields"
else
    fail "Directive validator should have rejected missing fields"
fi

# Validate example directive
assert_validator "$ACCORD_DIR/protocol/scan/validators/validate-directive.sh" \
    "$ACCORD_DIR/examples/multi-repo-project/accord_hub/teams/zliu/directives/dir-001-device-reboot.md" \
    "Example directive passes validation"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 20: History write helper (v2)
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 20] History write helper (v2)${NC}"

TEST20_HIST="$TMPDIR/test20-history"

# Write a history entry
bash "$ACCORD_DIR/protocol/history/write-history.sh" \
    --history-dir "$TEST20_HIST" \
    --request-id "req-001-test" \
    --from-status "pending" \
    --to-status "approved" \
    --actor "device-manager" \
    --detail "Approved by human review"

# Check file was created
DATE_TODAY="$(date -u +"%Y-%m-%d")"
HIST_FILE="$TEST20_HIST/${DATE_TODAY}-device-manager.jsonl"
assert_file "$HIST_FILE" "History file created with correct name"

# Validate it's valid JSON
if echo "$(head -1 "$HIST_FILE")" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    pass "History entry is valid JSON"
else
    fail "History entry is not valid JSON"
fi

# Check required fields
hist_entry="$(head -1 "$HIST_FILE")"
for field in ts request_id from_status to_status actor; do
    if echo "$hist_entry" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$field' in d" 2>/dev/null; then
        pass "History entry has field: $field"
    else
        fail "History entry missing field: $field"
    fi
done

# Write with directive-id
bash "$ACCORD_DIR/protocol/history/write-history.sh" \
    --history-dir "$TEST20_HIST" \
    --request-id "dir-001-test" \
    --from-status "pending" \
    --to-status "in-progress" \
    --actor "orchestrator" \
    --directive-id "dir-001-test" \
    --detail "Decomposed into 2 requests"

ORCH_FILE="$TEST20_HIST/${DATE_TODAY}-orchestrator.jsonl"
assert_file "$ORCH_FILE" "Orchestrator history file created"

if head -1 "$ORCH_FILE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['directive_id']=='dir-001-test'" 2>/dev/null; then
    pass "History entry includes directive_id"
else
    fail "History entry missing directive_id"
fi

# Multiple entries go to same file (actor file)
bash "$ACCORD_DIR/protocol/history/write-history.sh" \
    --history-dir "$TEST20_HIST" \
    --request-id "req-002-test" \
    --from-status "approved" \
    --to-status "in-progress" \
    --actor "device-manager"

line_count=$(wc -l < "$HIST_FILE" | xargs)
if [[ "$line_count" -eq 2 ]]; then
    pass "Multiple entries append to same actor file ($line_count lines)"
else
    fail "Expected 2 lines in actor file, got $line_count"
fi

# ══════════════════════════════════════════════════════════════════════════════
# TEST 21: Registry sync via accord-sync.sh (v2)
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 21] Registry sync via accord-sync.sh (v2)${NC}"

# Create a hub
TEST21_HUB="$TMPDIR/test21-hub.git"
git init --bare "$TEST21_HUB" > /dev/null 2>&1

# Init svc-a
TEST21_SVCA="$TMPDIR/test21-svc-a"
mkdir -p "$TEST21_SVCA"
(cd "$TEST21_SVCA" && git init > /dev/null 2>&1 && git config user.email "test@accord.dev" && git config user.name "Accord Test")
bash "$ACCORD_DIR/init.sh" \
    --project-name "test-regsync" \
    --repo-model multi-repo \
    --services "svc-a,svc-b" \
    --hub "$TEST21_HUB" \
    --adapter none \
    --target-dir "$TEST21_SVCA" \
    --no-interactive > /dev/null 2>&1

# svc-a should have a registry file
assert_file "$TEST21_SVCA/.accord/registry/svc-a.md" "svc-a has local registry"

# Push should sync registry to hub
bash "$ACCORD_DIR/accord-sync.sh" push --target-dir "$TEST21_SVCA" --service-name svc-a > /dev/null 2>&1

assert_file "$TEST21_SVCA/.accord/hub/registry/svc-a.md" "Registry pushed to hub"

# Init svc-b
TEST21_SVCB="$TMPDIR/test21-svc-b"
mkdir -p "$TEST21_SVCB"
(cd "$TEST21_SVCB" && git init > /dev/null 2>&1 && git config user.email "test@accord.dev" && git config user.name "Accord Test")
bash "$ACCORD_DIR/init.sh" \
    --project-name "test-regsync" \
    --repo-model multi-repo \
    --services "svc-b,svc-a" \
    --hub "$TEST21_HUB" \
    --adapter none \
    --target-dir "$TEST21_SVCB" \
    --no-interactive > /dev/null 2>&1

# svc-b pulls — should get svc-a's registry
bash "$ACCORD_DIR/accord-sync.sh" pull --target-dir "$TEST21_SVCB" --service-name svc-b > /dev/null 2>&1

assert_file "$TEST21_SVCB/.accord/registry/svc-a.md" "svc-b pulled svc-a's registry from hub"

# svc-b's own registry should NOT be overwritten by pull
assert_file "$TEST21_SVCB/.accord/registry/svc-b.md" "svc-b's own registry preserved after pull"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 22: Request template v2 fields (backward-compatible)
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 22] Request template v2 fields${NC}"

assert_contains "$ACCORD_DIR/protocol/templates/request.md.template" "v2 fields" "Request template has v2 fields section"
assert_contains "$ACCORD_DIR/protocol/templates/request.md.template" "directive:" "Request template has directive field"
assert_contains "$ACCORD_DIR/protocol/templates/request.md.template" "on_behalf_of:" "Request template has on_behalf_of field"
assert_contains "$ACCORD_DIR/protocol/templates/request.md.template" "routed_by:" "Request template has routed_by field"
assert_contains "$ACCORD_DIR/protocol/templates/request.md.template" "originated_from:" "Request template has originated_from field"

# Existing request validator still works with v1 requests (backward-compat)
assert_validator "$ACCORD_DIR/protocol/scan/validators/validate-request.sh" \
    "$ACCORD_DIR/examples/multi-repo-project/accord_hub/teams/zliu/.accord/comms/archive/req-000-service-joined-device-manager.md" \
    "v1 request still validates after template update"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 23: Example hub v2 files exist
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 23] Example hub v2 files${NC}"

HUB_EXAMPLE="$ACCORD_DIR/examples/multi-repo-project/accord_hub"
HUB_TEAM="$HUB_EXAMPLE/teams/zliu"

assert_file "$HUB_EXAMPLE/accord.yaml"                              "Hub accord.yaml exists"
assert_file "$HUB_TEAM/config.yaml"                                  "Hub team config.yaml exists"
assert_contains "$HUB_TEAM/config.yaml" "role: orchestrator"         "Hub config has role: orchestrator"
assert_contains "$HUB_TEAM/config.yaml" 'version: "1.0"'             "Hub config has version 1.0"

assert_file "$HUB_TEAM/directives/dir-001-device-reboot.md"          "Example directive exists"
assert_file "$HUB_TEAM/registry/device-manager.yaml"                 "Hub has device-manager registry"
assert_file "$HUB_TEAM/registry/web-server.yaml"                     "Hub has web-server registry"
assert_file "$HUB_TEAM/registry/frontend.yaml"                       "Hub has frontend registry"
assert_dir  "$HUB_TEAM/comms/inbox/_team"                            "Hub has cross-team inbox"
assert_file "$HUB_TEAM/comms/history/2026-02-13-orchestrator.jsonl"  "Hub has history entries"

# No stale root-level dirs (v1 cleanup)
if [[ ! -d "$HUB_EXAMPLE/comms" && ! -d "$HUB_EXAMPLE/contracts" && ! -d "$HUB_EXAMPLE/registry" ]]; then
    pass "No stale v1 root-level dirs"
else
    fail "Stale v1 root-level dirs still exist (comms/, contracts/, or registry/)"
fi

# Validate example history entries are valid JSON
hist_valid=true
while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    if ! echo "$line" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
        hist_valid=false
        break
    fi
done < "$HUB_TEAM/comms/history/2026-02-13-orchestrator.jsonl"

if [[ "$hist_valid" == true ]]; then
    pass "Example history entries are valid JSONL"
else
    fail "Example history entries contain invalid JSON"
fi

# ══════════════════════════════════════════════════════════════════════════════
# TEST 24: Scheduler script exists and runs (v2)
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 24] Hub Service (v4)${NC}"

assert_file "$ACCORD_DIR/agent/package.json" "agent/package.json exists"
assert_file "$ACCORD_DIR/agent/server/scheduler.ts" "Hub Service scheduler exists"
assert_file "$ACCORD_DIR/agent/server/http.ts" "Hub Service http server exists"
assert_file "$ACCORD_DIR/agent/server/event-bus.ts" "Hub Service event bus exists"
assert_contains "$ACCORD_DIR/agent/package.json" "fastify" "package.json includes fastify dependency"
assert_contains "$ACCORD_DIR/agent/package.json" "1.0.0" "package.json version is 1.0.0"

# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}[Test 25] Batch service init (--init-services)${NC}"

TEST25_DIR="$TMPDIR/test25"
mkdir -p "$TEST25_DIR/hub"
mkdir -p "$TEST25_DIR/svc-a"
mkdir -p "$TEST25_DIR/svc-b"

# Init hub with --init-services (using local path as hub URL since no real git remote)
# We simulate by creating a bare git repo as the hub
(cd "$TEST25_DIR/hub" && git init --quiet)
(cd "$TEST25_DIR/svc-a" && git init --quiet)
(cd "$TEST25_DIR/svc-b" && git init --quiet)

bash "$ACCORD_DIR/init.sh" \
    --role orchestrator \
    --project-name "batch-test" \
    --services "svc-a,svc-b" \
    --adapter none \
    --target-dir "$TEST25_DIR/hub" \
    --hub "$TEST25_DIR/hub" \
    --init-services \
    --no-interactive > /dev/null 2>&1

# Hub should be initialized
assert_file "$TEST25_DIR/hub/config.yaml" "Hub config.yaml created"
if grep -q "role: orchestrator" "$TEST25_DIR/hub/config.yaml"; then
    pass "Hub has role: orchestrator"
else
    fail "Hub should have role: orchestrator"
fi

# Service repos should be initialized
assert_file "$TEST25_DIR/svc-a/.accord/config.yaml" "svc-a .accord/config.yaml created"
assert_file "$TEST25_DIR/svc-b/.accord/config.yaml" "svc-b .accord/config.yaml created"

if grep -q "multi-repo" "$TEST25_DIR/svc-a/.accord/config.yaml"; then
    pass "svc-a has repo_model: multi-repo"
else
    fail "svc-a should have multi-repo model"
fi

if grep -q "multi-repo" "$TEST25_DIR/svc-b/.accord/config.yaml"; then
    pass "svc-b has repo_model: multi-repo"
else
    fail "svc-b should have multi-repo model"
fi

# Both services should have contracts dir
assert_dir "$TEST25_DIR/svc-a/.accord/contracts" "svc-a contracts dir exists"
assert_dir "$TEST25_DIR/svc-b/.accord/contracts" "svc-b contracts dir exists"

# Both services should have comms
assert_dir "$TEST25_DIR/svc-a/.accord/comms/inbox" "svc-a comms inbox exists"
assert_dir "$TEST25_DIR/svc-b/.accord/comms/inbox" "svc-b comms inbox exists"

# --init-services without --role orchestrator should fail
if bash "$ACCORD_DIR/init.sh" --init-services --project-name "fail-test" --services "x" --adapter none --target-dir "$TEST25_DIR/hub" --no-interactive > /dev/null 2>&1; then
    fail "--init-services should require --role orchestrator"
else
    pass "--init-services fails without --role orchestrator"
fi

# Missing service dir should warn but not fail
TEST25_MISS="$TMPDIR/test25-miss"
mkdir -p "$TEST25_MISS/hub"
(cd "$TEST25_MISS/hub" && git init --quiet)
miss_output=$(bash "$ACCORD_DIR/init.sh" \
    --role orchestrator \
    --project-name "miss-test" \
    --services "existing,missing" \
    --adapter none \
    --target-dir "$TEST25_MISS/hub" \
    --hub "$TEST25_MISS/hub" \
    --init-services \
    --force \
    --no-interactive 2>&1)
if echo "$miss_output" | grep -q "skipping"; then
    pass "Missing service dir is skipped with warning"
else
    fail "Should warn about missing service directory"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 26: Command request format validation
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}Test 26: Command request format validation${NC}"

TEST26_DIR="$TMPDIR/test26"
mkdir -p "$TEST26_DIR"

# Valid command request
cat > "$TEST26_DIR/req-001-cmd-status.md" <<'EOF'
---
id: req-001-cmd-status
from: orchestrator
to: frontend
scope: external
type: command
command: status
command_args: ""
priority: medium
status: pending
created: 2026-02-11T10:00:00Z
updated: 2026-02-11T10:00:00Z
---

## What

Remote command: `status`

## Proposed Change

N/A — diagnostic command, no contract changes.

## Why

Orchestrator diagnostic: requested by user.

## Impact

None — read-only diagnostic command.
EOF

if bash "$ACCORD_DIR/protocol/scan/validators/validate-request.sh" "$TEST26_DIR/req-001-cmd-status.md" 2>/dev/null; then
    pass "Valid command request passes validation"
else
    fail "Valid command request should pass validation"
fi

# Command request with all valid command types
for cmd in status scan check-inbox validate; do
    local_req="$TEST26_DIR/req-cmd-$cmd.md"
    cat > "$local_req" <<CMDEOF
---
id: req-002-cmd-$cmd
from: orchestrator
to: frontend
scope: external
type: command
command: $cmd
priority: medium
status: pending
created: 2026-02-11T10:00:00Z
updated: 2026-02-11T10:00:00Z
---

## What

Remote command: \`$cmd\`

## Proposed Change

N/A

## Why

Diagnostic.

## Impact

None.
CMDEOF
    if bash "$ACCORD_DIR/protocol/scan/validators/validate-request.sh" "$local_req" 2>/dev/null; then
        pass "Command type '$cmd' passes validation"
    else
        fail "Command type '$cmd' should pass validation"
    fi
done

# ══════════════════════════════════════════════════════════════════════════════
# Test 27: Orchestrator command files installed
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}Test 27: Orchestrator command files installed${NC}"

TEST27_DIR="$TMPDIR/test27"
mkdir -p "$TEST27_DIR"
(cd "$TEST27_DIR" && git init --quiet)

bash "$ACCORD_DIR/init.sh" \
    --role orchestrator \
    --project-name "cmd-test" \
    --services "svc-a,svc-b" \
    --adapter claude-code \
    --target-dir "$TEST27_DIR" \
    --force \
    --no-interactive > /dev/null 2>&1

assert_file "$TEST27_DIR/.claude/commands/accord-remote.md" "accord-remote.md installed"
if [[ ! -f "$TEST27_DIR/.claude/commands/accord-remote-command.md" ]]; then
    pass "accord-remote-command.md does NOT exist (replaced by accord-remote.md)"
else
    fail "accord-remote-command.md should not exist (replaced by accord-remote.md)"
fi
assert_file "$TEST27_DIR/.claude/commands/accord-check-results.md" "accord-check-results.md installed"
assert_file "$TEST27_DIR/.claude/commands/accord-decompose.md" "accord-decompose.md still installed"
assert_file "$TEST27_DIR/.claude/commands/accord-route.md" "accord-route.md still installed"
assert_file "$TEST27_DIR/.claude/commands/accord-monitor.md" "accord-monitor.md still installed"
assert_file "$TEST27_DIR/.claude/commands/accord-check-inbox.md" "orchestrator accord-check-inbox.md still installed"

# Check CLAUDE.md has ON_COMMAND section
assert_contains "$TEST27_DIR/CLAUDE.md" "ON_COMMAND" "CLAUDE.md contains ON_COMMAND section"

# ══════════════════════════════════════════════════════════════════════════════
# Test 28: Command validation edge cases
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}Test 28: Command validation edge cases${NC}"

TEST28_DIR="$TMPDIR/test28"
mkdir -p "$TEST28_DIR"

# type: command without command: field should FAIL
cat > "$TEST28_DIR/req-bad-no-cmd.md" <<'EOF'
---
id: req-010-cmd-missing
from: orchestrator
to: frontend
scope: external
type: command
priority: medium
status: pending
created: 2026-02-11T10:00:00Z
updated: 2026-02-11T10:00:00Z
---

## What

Missing command field.

## Proposed Change

N/A

## Why

Test.

## Impact

None.
EOF

if bash "$ACCORD_DIR/protocol/scan/validators/validate-request.sh" "$TEST28_DIR/req-bad-no-cmd.md" > /dev/null 2>&1; then
    fail "type: command without command: field should fail"
else
    pass "type: command without command: field fails validation"
fi

# Non-standard command value should warn but not fail
cat > "$TEST28_DIR/req-bad-cmd-value.md" <<'EOF'
---
id: req-011-cmd-unknown
from: orchestrator
to: frontend
scope: external
type: command
command: restart
priority: medium
status: pending
created: 2026-02-11T10:00:00Z
updated: 2026-02-11T10:00:00Z
---

## What

Unknown command.

## Proposed Change

N/A

## Why

Test.

## Impact

None.
EOF

output28=$(bash "$ACCORD_DIR/protocol/scan/validators/validate-request.sh" "$TEST28_DIR/req-bad-cmd-value.md" 2>&1 || true)
if echo "$output28" | grep -q "Non-standard command"; then
    pass "Non-standard command value produces warning"
else
    fail "Non-standard command value should produce warning"
fi
# Should still pass (warning, not error)
if bash "$ACCORD_DIR/protocol/scan/validators/validate-request.sh" "$TEST28_DIR/req-bad-cmd-value.md" > /dev/null 2>&1; then
    pass "Non-standard command value does not cause failure"
else
    fail "Non-standard command value should only warn, not fail"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 29: Orchestrator config with repo URLs
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}Test 29: Orchestrator config with repo URLs${NC}"

TEST29_DIR="$TMPDIR/test29"
mkdir -p "$TEST29_DIR"
(cd "$TEST29_DIR" && git init --quiet)

bash "$ACCORD_DIR/init.sh" \
    --role orchestrator \
    --project-name "repo-test" \
    --services "svc-a,svc-b,svc-c" \
    --service-repos "svc-a=git@github.com:org/svc-a.git,svc-c=git@github.com:org/svc-c.git" \
    --adapter none \
    --target-dir "$TEST29_DIR" \
    --force \
    --no-interactive > /dev/null 2>&1

assert_file "$TEST29_DIR/config.yaml" "Orchestrator config.yaml created"
assert_contains "$TEST29_DIR/config.yaml" "repo: git@github.com:org/svc-a.git" "svc-a has repo URL"
assert_contains "$TEST29_DIR/config.yaml" "repo: git@github.com:org/svc-c.git" "svc-c has repo URL"
assert_not_contains "$TEST29_DIR/config.yaml" "svc-b.*repo:" "svc-b has no repo URL (not provided)"

# Verify the YAML structure: name then repo on next line
if grep -A1 "name: svc-a" "$TEST29_DIR/config.yaml" | grep -q "repo:"; then
    pass "repo: field follows service name correctly"
else
    fail "repo: field should follow service name"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 30: Config without repos (backward compat)
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}Test 30: Config without repos (backward compat)${NC}"

TEST30_DIR="$TMPDIR/test30"
mkdir -p "$TEST30_DIR"
(cd "$TEST30_DIR" && git init --quiet)

bash "$ACCORD_DIR/init.sh" \
    --role orchestrator \
    --project-name "no-repo-test" \
    --services "frontend,backend" \
    --adapter none \
    --target-dir "$TEST30_DIR" \
    --force \
    --no-interactive > /dev/null 2>&1

assert_file "$TEST30_DIR/config.yaml" "Orchestrator config.yaml created (no repos)"
assert_not_contains "$TEST30_DIR/config.yaml" "repo:" "No repo: fields when --service-repos not provided"
assert_contains "$TEST30_DIR/config.yaml" "name: frontend" "frontend service exists"
assert_contains "$TEST30_DIR/config.yaml" "name: backend" "backend service exists"

# Also test --repo flag for service config
TEST30_SVC="$TMPDIR/test30-svc"
mkdir -p "$TEST30_SVC"
(cd "$TEST30_SVC" && git init --quiet)

bash "$ACCORD_DIR/init.sh" \
    --project-name "svc-repo-test" \
    --services "my-svc,other-svc" \
    --repo "git@github.com:org/my-svc.git" \
    --adapter none \
    --target-dir "$TEST30_SVC" \
    --force \
    --no-interactive > /dev/null 2>&1

assert_file "$TEST30_SVC/.accord/config.yaml" "Service config.yaml created with --repo"
assert_contains "$TEST30_SVC/.accord/config.yaml" "repo: git@github.com:org/my-svc.git" "Service config has repo URL"

# ══════════════════════════════════════════════════════════════════════════════
# Test 31: Batch remote command naming
# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}Test 31: Batch remote command naming${NC}"

# Verify the source command file exists in the adapter
assert_file "$ACCORD_DIR/adapters/claude-code/orchestrator/commands/accord-remote.md" \
    "accord-remote.md exists in adapter source"

# Verify the old file does NOT exist in the adapter
if [[ ! -f "$ACCORD_DIR/adapters/claude-code/orchestrator/commands/accord-remote-command.md" ]]; then
    pass "accord-remote-command.md removed from adapter source"
else
    fail "accord-remote-command.md should be removed from adapter source"
fi

# Verify the new command heading matches the filename
actual_heading="$(head -1 "$ACCORD_DIR/adapters/claude-code/orchestrator/commands/accord-remote.md")"
if [[ "$actual_heading" == "# /accord-remote" ]]; then
    pass "accord-remote.md heading matches filename"
else
    fail "accord-remote.md heading should be '# /accord-remote', got '$actual_heading'"
fi

# Verify orchestrator CLAUDE.md template references /accord-remote (not /accord-remote-command)
assert_contains "$ACCORD_DIR/adapters/claude-code/orchestrator/CLAUDE.md.template" \
    "/accord-remote " "Template references /accord-remote"
assert_not_contains "$ACCORD_DIR/adapters/claude-code/orchestrator/CLAUDE.md.template" \
    "/accord-remote-command" "Template does NOT reference /accord-remote-command"

# Verify install.sh references /accord-remote
assert_contains "$ACCORD_DIR/adapters/claude-code/orchestrator/install.sh" \
    "/accord-remote," "install.sh references /accord-remote"
assert_not_contains "$ACCORD_DIR/adapters/claude-code/orchestrator/install.sh" \
    "/accord-remote-command" "install.sh does NOT reference /accord-remote-command"

# Verify check-results references /accord-remote (not /accord-remote-command)
assert_contains "$ACCORD_DIR/adapters/claude-code/orchestrator/commands/accord-check-results.md" \
    "/accord-remote" "check-results references /accord-remote"
assert_not_contains "$ACCORD_DIR/adapters/claude-code/orchestrator/commands/accord-check-results.md" \
    "/accord-remote-command" "check-results does NOT reference /accord-remote-command"

# Install to a fresh dir and verify batch command is installed
TEST31_DIR="$TMPDIR/test31"
mkdir -p "$TEST31_DIR"
(cd "$TEST31_DIR" && git init --quiet)

bash "$ACCORD_DIR/init.sh" \
    --role orchestrator \
    --project-name "batch-cmd-test" \
    --services "svc-a,svc-b,svc-c" \
    --adapter claude-code \
    --target-dir "$TEST31_DIR" \
    --force \
    --no-interactive > /dev/null 2>&1

assert_file "$TEST31_DIR/.claude/commands/accord-remote.md" "accord-remote.md installed to project"
if [[ ! -f "$TEST31_DIR/.claude/commands/accord-remote-command.md" ]]; then
    pass "accord-remote-command.md NOT installed to project"
else
    fail "accord-remote-command.md should not be installed"
fi

# Verify CLAUDE.md has updated ON_COMMAND section
assert_contains "$TEST31_DIR/CLAUDE.md" "/accord-remote " "Installed CLAUDE.md references /accord-remote"
assert_not_contains "$TEST31_DIR/CLAUDE.md" "/accord-remote-command" "Installed CLAUDE.md does NOT reference /accord-remote-command"

# ══════════════════════════════════════════════════════════════════════════════
# TEST 32: Hub Service (v4) — TS agent tests in agent/tests/ (vitest)
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}[Test 32] Hub Service structure${NC}"

assert_file "$ACCORD_DIR/agent/server/http.ts" "Hub Service http.ts exists"
assert_file "$ACCORD_DIR/agent/server/scheduler.ts" "Hub Service scheduler.ts exists"
assert_file "$ACCORD_DIR/agent/server/event-bus.ts" "Hub Service event-bus.ts exists"
assert_file "$ACCORD_DIR/agent/server/api/services.ts" "API api/services.ts exists"
assert_file "$ACCORD_DIR/agent/server/api/requests.ts" "API api/requests.ts exists"
assert_file "$ACCORD_DIR/agent/server/api/hub.ts" "API api/hub.ts exists"
assert_file "$ACCORD_DIR/agent/ui/index.html" "UI index.html exists"
assert_file "$ACCORD_DIR/agent/ui/src/App.tsx" "UI App.tsx exists"
assert_contains "$ACCORD_DIR/agent/package.json" '"fastify"' "package.json has fastify"
assert_contains "$ACCORD_DIR/agent/package.json" '"1.0.0"' "package.json version is 1.0.0"

# ══════════════════════════════════════════════════════════════════════════════
# NOTE: Tests 33-46 (daemon tests) removed in v4.
# Daemon functionality is now part of the Hub Service (agent/).
# Run `cd agent && npm test` for 80 TS-level tests covering dispatcher,
# worker pool, event bus, commands, sessions, and integration.
# ══════════════════════════════════════════════════════════════════════════════

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
