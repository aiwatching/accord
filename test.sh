#!/usr/bin/env bash
# Accord Lite — Integration Tests
#
# Usage: bash test.sh

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
TOTAL=0
FAILURES=()

# ── Colors ────────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Test Helpers ──────────────────────────────────────────────────────────────

assert() {
    local desc="$1"
    shift
    TOTAL=$((TOTAL + 1))
    if "$@" 2>/dev/null; then
        PASS=$((PASS + 1))
        echo -e "  ${GREEN}PASS${NC} $desc"
    else
        FAIL=$((FAIL + 1))
        FAILURES+=("$desc")
        echo -e "  ${RED}FAIL${NC} $desc"
    fi
}

assert_file_exists() {
    assert "$1 exists" test -f "$2"
}

assert_dir_exists() {
    assert "$1 exists" test -d "$2"
}

assert_file_contains() {
    assert "$1 contains '$2'" grep -qF "$2" "$3"
}

assert_file_not_contains() {
    assert "$1 does not contain '$2'" bash -c "! grep -qF '$2' '$3'"
}

section() {
    echo ""
    echo -e "${CYAN}${BOLD}── $1 ──${NC}"
}

# ── Setup ─────────────────────────────────────────────────────────────────────

TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

# ════════════════════════════════════════════════════════════════════════════════
# Test Suite 1: Repository Structure
# ════════════════════════════════════════════════════════════════════════════════

section "Repository Structure"

assert_file_exists "README.md" "$ACCORD_DIR/README.md"
assert_file_exists "CLAUDE.md" "$ACCORD_DIR/CLAUDE.md"
assert_file_exists "LICENSE" "$ACCORD_DIR/LICENSE"
assert_file_exists ".gitignore" "$ACCORD_DIR/.gitignore"
assert_file_exists "init.sh" "$ACCORD_DIR/init.sh"
assert_file_exists "install.sh" "$ACCORD_DIR/install.sh"
assert_file_exists "test.sh" "$ACCORD_DIR/test.sh"
assert_file_exists "docs/DESIGN.md" "$ACCORD_DIR/docs/DESIGN.md"
assert_file_exists "docs/SESSION_CONTEXT.md" "$ACCORD_DIR/docs/SESSION_CONTEXT.md"

# ════════════════════════════════════════════════════════════════════════════════
# Test Suite 2: Templates
# ════════════════════════════════════════════════════════════════════════════════

section "Templates"

assert_file_exists "module-map.yaml.template" "$ACCORD_DIR/templates/module-map.yaml.template"
assert_file_exists "contract.md.template" "$ACCORD_DIR/templates/contract.md.template"
assert_file_exists "plan.yaml.template" "$ACCORD_DIR/templates/plan.yaml.template"
assert_file_exists "architecture.md.template" "$ACCORD_DIR/templates/architecture.md.template"
assert_file_exists "claude-section.md.template" "$ACCORD_DIR/templates/claude-section.md.template"

# Validate template content
assert_file_contains "module-map template has version" "version:" "$ACCORD_DIR/templates/module-map.yaml.template"
assert_file_contains "module-map template has modules" "modules:" "$ACCORD_DIR/templates/module-map.yaml.template"
assert_file_contains "module-map template has build_order" "build_order:" "$ACCORD_DIR/templates/module-map.yaml.template"

assert_file_contains "contract template has module placeholder" "{{MODULE_NAME}}" "$ACCORD_DIR/templates/contract.md.template"
assert_file_contains "contract template has Public API section" "## Public API" "$ACCORD_DIR/templates/contract.md.template"
assert_file_contains "contract template has Dependencies section" "## Dependencies" "$ACCORD_DIR/templates/contract.md.template"

assert_file_contains "plan template has steps" "steps:" "$ACCORD_DIR/templates/plan.yaml.template"
assert_file_contains "plan template has status" "status:" "$ACCORD_DIR/templates/plan.yaml.template"

assert_file_contains "architecture template has project placeholder" "{{PROJECT_NAME}}" "$ACCORD_DIR/templates/architecture.md.template"
assert_file_contains "architecture template has Module table" "## Modules" "$ACCORD_DIR/templates/architecture.md.template"

assert_file_contains "claude-section has Accord Lite header" "## Accord Lite" "$ACCORD_DIR/templates/claude-section.md.template"
assert_file_contains "claude-section has knowledge base ref" "module-map.yaml" "$ACCORD_DIR/templates/claude-section.md.template"
assert_file_contains "claude-section has /accord-plan ref" "/accord-plan" "$ACCORD_DIR/templates/claude-section.md.template"

# ════════════════════════════════════════════════════════════════════════════════
# Test Suite 3: Skills
# ════════════════════════════════════════════════════════════════════════════════

section "Skills"

assert_file_exists "accord-scan SKILL.md" "$ACCORD_DIR/skills/accord-scan/SKILL.md"
assert_file_exists "accord-architect SKILL.md" "$ACCORD_DIR/skills/accord-architect/SKILL.md"

# Scan skill content
assert_file_contains "scan skill mentions module-map.yaml" "module-map.yaml" "$ACCORD_DIR/skills/accord-scan/SKILL.md"
assert_file_contains "scan skill mentions ARCHITECTURE.md" "ARCHITECTURE.md" "$ACCORD_DIR/skills/accord-scan/SKILL.md"
assert_file_contains "scan skill mentions contracts/" "contracts/" "$ACCORD_DIR/skills/accord-scan/SKILL.md"
assert_file_contains "scan skill has full mode" "full" "$ACCORD_DIR/skills/accord-scan/SKILL.md"
assert_file_contains "scan skill has diff mode" "diff" "$ACCORD_DIR/skills/accord-scan/SKILL.md"
assert_file_contains "scan skill has refresh mode" "refresh" "$ACCORD_DIR/skills/accord-scan/SKILL.md"
assert_file_contains "scan skill mentions build files" "pom.xml" "$ACCORD_DIR/skills/accord-scan/SKILL.md"
assert_file_contains "scan skill mentions topological sort" "topological sort" "$ACCORD_DIR/skills/accord-scan/SKILL.md"

# Architect skill content
assert_file_contains "architect skill has Plan phase" "Phase 1" "$ACCORD_DIR/skills/accord-architect/SKILL.md"
assert_file_contains "architect skill has Execute phase" "Phase 2" "$ACCORD_DIR/skills/accord-architect/SKILL.md"
assert_file_contains "architect skill mentions plans/" "plans/" "$ACCORD_DIR/skills/accord-architect/SKILL.md"
assert_file_contains "architect skill mentions dependency order" "dependency order" "$ACCORD_DIR/skills/accord-architect/SKILL.md"
assert_file_contains "architect skill mentions contract loading" "contracts_to_load" "$ACCORD_DIR/skills/accord-architect/SKILL.md"
assert_file_contains "architect skill mentions Replan" "Replan" "$ACCORD_DIR/skills/accord-architect/SKILL.md"

# ════════════════════════════════════════════════════════════════════════════════
# Test Suite 4: Commands
# ════════════════════════════════════════════════════════════════════════════════

section "Commands"

assert_file_exists "accord-scan command" "$ACCORD_DIR/commands/accord-scan.md"
assert_file_exists "accord-plan command" "$ACCORD_DIR/commands/accord-plan.md"
assert_file_exists "accord-execute command" "$ACCORD_DIR/commands/accord-execute.md"
assert_file_exists "accord-status command" "$ACCORD_DIR/commands/accord-status.md"
assert_file_exists "accord-replan command" "$ACCORD_DIR/commands/accord-replan.md"

# Command content validation
assert_file_contains "scan command references scan skill" "accord-scan" "$ACCORD_DIR/commands/accord-scan.md"
assert_file_contains "plan command references architect skill" "accord-architect" "$ACCORD_DIR/commands/accord-plan.md"
assert_file_contains "execute command references architect skill" "accord-architect" "$ACCORD_DIR/commands/accord-execute.md"
assert_file_contains "status command references plans/" "plans/" "$ACCORD_DIR/commands/accord-status.md"
assert_file_contains "replan command references architect skill" "accord-architect" "$ACCORD_DIR/commands/accord-replan.md"

# Commands reference $ARGUMENTS
assert_file_contains "scan command uses ARGUMENTS" 'ARGUMENTS' "$ACCORD_DIR/commands/accord-scan.md"
assert_file_contains "plan command uses ARGUMENTS" 'ARGUMENTS' "$ACCORD_DIR/commands/accord-plan.md"
assert_file_contains "execute command uses ARGUMENTS" 'ARGUMENTS' "$ACCORD_DIR/commands/accord-execute.md"

# ════════════════════════════════════════════════════════════════════════════════
# Test Suite 5: init.sh
# ════════════════════════════════════════════════════════════════════════════════

section "init.sh — Basic Scaffolding"

# Test: init.sh creates correct structure
PROJ1="$TMPDIR_BASE/proj1"
mkdir -p "$PROJ1"
(cd "$PROJ1" && bash "$ACCORD_DIR/init.sh" --skip-claude-md 2>/dev/null)

assert_dir_exists ".accord/" "$PROJ1/.accord"
assert_dir_exists ".accord/contracts/" "$PROJ1/.accord/contracts"
assert_dir_exists ".accord/plans/" "$PROJ1/.accord/plans"
assert_dir_exists ".accord/plans/archive/" "$PROJ1/.accord/plans/archive"
assert_file_exists ".accord/module-map.yaml" "$PROJ1/.accord/module-map.yaml"
assert_file_exists ".accord/ARCHITECTURE.md" "$PROJ1/.accord/ARCHITECTURE.md"

# Verify module-map.yaml content
assert_file_contains "module-map has version" "version:" "$PROJ1/.accord/module-map.yaml"
assert_file_contains "module-map has project name" "name:" "$PROJ1/.accord/module-map.yaml"
assert_file_contains "module-map has modules key" "modules:" "$PROJ1/.accord/module-map.yaml"

# Verify skills installed
assert_dir_exists ".claude/skills/accord-scan/" "$PROJ1/.claude/skills/accord-scan"
assert_dir_exists ".claude/skills/accord-architect/" "$PROJ1/.claude/skills/accord-architect"
assert_file_exists ".claude/skills/accord-scan/SKILL.md" "$PROJ1/.claude/skills/accord-scan/SKILL.md"
assert_file_exists ".claude/skills/accord-architect/SKILL.md" "$PROJ1/.claude/skills/accord-architect/SKILL.md"

# Verify commands installed
assert_file_exists ".claude/commands/accord-scan.md" "$PROJ1/.claude/commands/accord-scan.md"
assert_file_exists ".claude/commands/accord-plan.md" "$PROJ1/.claude/commands/accord-plan.md"
assert_file_exists ".claude/commands/accord-execute.md" "$PROJ1/.claude/commands/accord-execute.md"
assert_file_exists ".claude/commands/accord-status.md" "$PROJ1/.claude/commands/accord-status.md"
assert_file_exists ".claude/commands/accord-replan.md" "$PROJ1/.claude/commands/accord-replan.md"

# ════════════════════════════════════════════════════════════════════════════════
# Test Suite 6: init.sh — CLAUDE.md Injection
# ════════════════════════════════════════════════════════════════════════════════

section "init.sh — CLAUDE.md Injection"

# Test: creates CLAUDE.md when it doesn't exist
PROJ2="$TMPDIR_BASE/proj2"
mkdir -p "$PROJ2"
(cd "$PROJ2" && bash "$ACCORD_DIR/init.sh" 2>/dev/null)

assert_file_exists "CLAUDE.md created" "$PROJ2/CLAUDE.md"
assert_file_contains "CLAUDE.md has Accord Lite section" "## Accord Lite" "$PROJ2/CLAUDE.md"
assert_file_contains "CLAUDE.md has knowledge base ref" "module-map.yaml" "$PROJ2/CLAUDE.md"

# Test: appends to existing CLAUDE.md
PROJ3="$TMPDIR_BASE/proj3"
mkdir -p "$PROJ3"
echo "# My Project" > "$PROJ3/CLAUDE.md"
echo "Some existing content." >> "$PROJ3/CLAUDE.md"
(cd "$PROJ3" && bash "$ACCORD_DIR/init.sh" 2>/dev/null)

assert_file_contains "existing content preserved" "My Project" "$PROJ3/CLAUDE.md"
assert_file_contains "Accord section appended" "## Accord Lite" "$PROJ3/CLAUDE.md"

# Test: does not duplicate on re-run
(cd "$PROJ3" && bash "$ACCORD_DIR/init.sh" 2>/dev/null)
ACCORD_COUNT="$(grep -c "## Accord Lite" "$PROJ3/CLAUDE.md")"
assert "CLAUDE.md not duplicated on re-run (count=$ACCORD_COUNT)" test "$ACCORD_COUNT" -eq 1

# Test: --skip-claude-md doesn't create/modify CLAUDE.md
PROJ4="$TMPDIR_BASE/proj4"
mkdir -p "$PROJ4"
(cd "$PROJ4" && bash "$ACCORD_DIR/init.sh" --skip-claude-md 2>/dev/null)

assert "CLAUDE.md not created with --skip-claude-md" test ! -f "$PROJ4/CLAUDE.md"

# ════════════════════════════════════════════════════════════════════════════════
# Test Suite 7: init.sh — Idempotency
# ════════════════════════════════════════════════════════════════════════════════

section "init.sh — Idempotency"

# Test: running init.sh twice doesn't break things
PROJ5="$TMPDIR_BASE/proj5"
mkdir -p "$PROJ5"
(cd "$PROJ5" && bash "$ACCORD_DIR/init.sh" 2>/dev/null)
(cd "$PROJ5" && bash "$ACCORD_DIR/init.sh" 2>/dev/null)

assert_file_exists "module-map.yaml after re-run" "$PROJ5/.accord/module-map.yaml"
assert_file_exists "skills after re-run" "$PROJ5/.claude/skills/accord-scan/SKILL.md"
assert_file_exists "commands after re-run" "$PROJ5/.claude/commands/accord-scan.md"

# ════════════════════════════════════════════════════════════════════════════════
# Test Suite 8: init.sh — Force Mode
# ════════════════════════════════════════════════════════════════════════════════

section "init.sh — Force Mode"

PROJ6="$TMPDIR_BASE/proj6"
mkdir -p "$PROJ6"
(cd "$PROJ6" && bash "$ACCORD_DIR/init.sh" 2>/dev/null)

# Modify a skill file
echo "# modified" > "$PROJ6/.claude/skills/accord-scan/SKILL.md"

# Re-run without force — should not overwrite
(cd "$PROJ6" && bash "$ACCORD_DIR/init.sh" --skip-claude-md 2>/dev/null)
assert_file_contains "skill not overwritten without --force" "# modified" "$PROJ6/.claude/skills/accord-scan/SKILL.md"

# Re-run with force — should overwrite
(cd "$PROJ6" && bash "$ACCORD_DIR/init.sh" --force --skip-claude-md 2>/dev/null)
assert_file_contains "skill overwritten with --force" "Accord Scan" "$PROJ6/.claude/skills/accord-scan/SKILL.md"

# ════════════════════════════════════════════════════════════════════════════════
# Test Suite 9: init.sh — Project Name Detection
# ════════════════════════════════════════════════════════════════════════════════

section "init.sh — Project Name Detection"

# Test: detects project name from directory
PROJ7="$TMPDIR_BASE/my-cool-project"
mkdir -p "$PROJ7"
(cd "$PROJ7" && bash "$ACCORD_DIR/init.sh" --skip-claude-md 2>/dev/null)

assert_file_contains "project name from directory" "my-cool-project" "$PROJ7/.accord/module-map.yaml"

# ════════════════════════════════════════════════════════════════════════════════
# Test Suite 10: install.sh Syntax
# ════════════════════════════════════════════════════════════════════════════════

section "install.sh — Syntax Check"

assert "install.sh has valid bash syntax" bash -n "$ACCORD_DIR/install.sh"
assert "init.sh has valid bash syntax" bash -n "$ACCORD_DIR/init.sh"

# ════════════════════════════════════════════════════════════════════════════════
# Test Suite 11: No Old Files Remain
# ════════════════════════════════════════════════════════════════════════════════

section "Cleanup Verification"

assert "no agent/ directory" test ! -d "$ACCORD_DIR/agent"
assert "no adapters/ directory" test ! -d "$ACCORD_DIR/adapters"
assert "no protocol/ directory" test ! -d "$ACCORD_DIR/protocol"
assert "no examples/ directory" test ! -d "$ACCORD_DIR/examples"
assert "no setup.sh" test ! -f "$ACCORD_DIR/setup.sh"
assert "no upgrade.sh" test ! -f "$ACCORD_DIR/upgrade.sh"
assert "no uninstall.sh" test ! -f "$ACCORD_DIR/uninstall.sh"
assert "no accord-sync.sh" test ! -f "$ACCORD_DIR/accord-sync.sh"
assert "no accord-doctor.sh" test ! -f "$ACCORD_DIR/accord-doctor.sh"
assert "no VERSION" test ! -f "$ACCORD_DIR/VERSION"

# ════════════════════════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}, ${TOTAL} total"
echo -e "${BOLD}════════════════════════════════════════════${NC}"

if [[ ${#FAILURES[@]} -gt 0 ]]; then
    echo ""
    echo -e "${RED}Failed tests:${NC}"
    for f in "${FAILURES[@]}"; do
        echo -e "  ${RED}-${NC} $f"
    done
fi

echo ""

if [[ $FAIL -gt 0 ]]; then
    exit 1
fi
