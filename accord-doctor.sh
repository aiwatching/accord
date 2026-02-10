#!/usr/bin/env bash
# accord-doctor — Diagnose common Accord project issues
#
# Usage: accord-doctor.sh [--project-dir <path>] [--verbose]
#
# Checks:
#   - Directory structure completeness
#   - Config file validity
#   - Contract format (via validators)
#   - Request file format
#   - Cross-reference integrity
#   - Source/collected contract sync
#   - Stale request detection

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="."
VERBOSE=false

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-dir) PROJECT_DIR="$2"; shift 2 ;;
        --verbose)     VERBOSE=true; shift ;;
        --help)
            echo "Usage: accord-doctor.sh [--project-dir <path>] [--verbose]"
            echo "Diagnoses common issues in an Accord project."
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

PASS=0
FAIL=0
WARN=0

ok()   { echo -e "  ${GREEN}OK${NC}    $*"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}FAIL${NC}  $*"; FAIL=$((FAIL + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC}  $*"; WARN=$((WARN + 1)); }
info() { [[ "$VERBOSE" == true ]] && echo -e "  ${CYAN}INFO${NC}  $*" || true; }

# ── 1. Structure Checks ──────────────────────────────────────────────────────
echo -e "\n${BOLD}=== Accord Doctor ===${NC}"
echo -e "${BOLD}Project: $PROJECT_DIR${NC}\n"

echo -e "${BOLD}[Structure]${NC}"

if [[ -f "$PROJECT_DIR/.accord/config.yaml" ]]; then
    ok ".accord/config.yaml exists"
else
    fail ".accord/config.yaml not found — run 'accord init' first"
fi

if [[ -d "$PROJECT_DIR/contracts" ]]; then
    count=$(find "$PROJECT_DIR/contracts" -name "*.yaml" -type f | wc -l | xargs)
    ok "contracts/ directory exists ($count contract files)"
else
    fail "contracts/ directory not found"
fi

if [[ -d "$PROJECT_DIR/.agent-comms" ]]; then
    ok ".agent-comms/ directory exists"
else
    fail ".agent-comms/ directory not found"
fi

if [[ -f "$PROJECT_DIR/.agent-comms/PROTOCOL.md" ]]; then
    ok ".agent-comms/PROTOCOL.md exists"
else
    warn ".agent-comms/PROTOCOL.md missing — agents won't have protocol reference"
fi

if [[ -f "$PROJECT_DIR/.agent-comms/TEMPLATE.md" ]]; then
    ok ".agent-comms/TEMPLATE.md exists"
else
    warn ".agent-comms/TEMPLATE.md missing — agents won't have request template"
fi

# ── 2. Config Checks ─────────────────────────────────────────────────────────
echo -e "\n${BOLD}[Config]${NC}"

if [[ -f "$PROJECT_DIR/.accord/config.yaml" ]]; then
    config="$PROJECT_DIR/.accord/config.yaml"

    # Check for required keys
    if grep -q "^  name:" "$config"; then
        project_name=$(grep "^  name:" "$config" | head -1 | sed 's/.*name:[[:space:]]*//')
        ok "Project name: $project_name"
    else
        fail "Missing project name in config"
    fi

    if grep -q "^repo_model:" "$config"; then
        repo_model=$(grep "^repo_model:" "$config" | sed 's/repo_model:[[:space:]]*//')
        ok "Repo model: $repo_model"
    else
        fail "Missing repo_model in config"
    fi

    # Check each team has a contract file and inbox
    if grep -q "^teams:" "$config"; then
        teams=$(grep "^  - name:" "$config" | sed 's/.*name:[[:space:]]*//')
        for team in $teams; do
            if [[ -f "$PROJECT_DIR/contracts/${team}.yaml" ]]; then
                ok "Team '$team' has contract file"
            else
                fail "Team '$team' missing contract: contracts/${team}.yaml"
            fi

            if [[ -d "$PROJECT_DIR/.agent-comms/inbox/${team}" ]]; then
                ok "Team '$team' has inbox directory"
            else
                fail "Team '$team' missing inbox: .agent-comms/inbox/${team}/"
            fi
        done
    else
        warn "No teams defined in config"
    fi
fi

# ── 3. Service/Module Checks ─────────────────────────────────────────────────
# Find service configs
for svc_config in "$PROJECT_DIR"/*/.accord/config.yaml; do
    [[ -f "$svc_config" ]] || continue

    svc_dir=$(dirname "$(dirname "$svc_config")")
    svc_name=$(basename "$svc_dir")

    echo -e "\n${BOLD}[Service: $svc_name]${NC}"

    if grep -q "^modules:" "$svc_config"; then
        modules=$(grep "^  - name:" "$svc_config" | sed 's/.*name:[[:space:]]*//')
        for mod in $modules; do
            # Source contract
            src="$svc_dir/$mod/.accord/contract.md"
            if [[ -f "$src" ]]; then
                ok "Module '$mod' source contract exists"
            else
                fail "Module '$mod' missing source: $mod/.accord/contract.md"
            fi

            # Collected copy
            collected="$svc_dir/.accord/internal-contracts/${mod}.md"
            if [[ -f "$collected" ]]; then
                ok "Module '$mod' collected copy exists"
            else
                fail "Module '$mod' missing collected: .accord/internal-contracts/${mod}.md"
            fi

            # Source == Collected?
            if [[ -f "$src" && -f "$collected" ]]; then
                if diff -q "$src" "$collected" > /dev/null 2>&1; then
                    ok "Module '$mod' source matches collected copy"
                else
                    warn "Module '$mod' source and collected copy are OUT OF SYNC"
                    if [[ "$VERBOSE" == true ]]; then
                        echo "       Run: cp $src $collected"
                    fi
                fi
            fi

            # Module inbox
            if [[ -d "$svc_dir/.agent-comms/inbox/${mod}" ]]; then
                ok "Module '$mod' has inbox"
            else
                fail "Module '$mod' missing inbox: .agent-comms/inbox/${mod}/"
            fi
        done
    fi
done

# ── 4. Contract Validation ────────────────────────────────────────────────────
echo -e "\n${BOLD}[Contract Validation]${NC}"

validator_ext="$ACCORD_DIR/protocol/scan/validators/validate-openapi.sh"
validator_int="$ACCORD_DIR/protocol/scan/validators/validate-internal.sh"
validator_req="$ACCORD_DIR/protocol/scan/validators/validate-request.sh"

# External contracts
for f in "$PROJECT_DIR/contracts"/*.yaml; do
    [[ -f "$f" ]] || continue
    fname=$(basename "$f")
    if bash "$validator_ext" "$f" 2>/dev/null; then
        ok "External: $fname"
    else
        fail "External: $fname — format errors"
        [[ "$VERBOSE" == true ]] && bash "$validator_ext" "$f" 2>&1 | sed 's/^/       /'
    fi
done

# Internal contracts
for f in "$PROJECT_DIR"/*/.accord/internal-contracts/*.md; do
    [[ -f "$f" ]] || continue
    # Skip template placeholders
    if grep -q "{{" "$f"; then
        info "Skipping template: $f"
        continue
    fi
    fname=$(echo "$f" | sed "s|$PROJECT_DIR/||")
    if bash "$validator_int" "$f" 2>/dev/null; then
        ok "Internal: $fname"
    else
        fail "Internal: $fname — format errors"
        [[ "$VERBOSE" == true ]] && bash "$validator_int" "$f" 2>&1 | sed 's/^/       /'
    fi
done

# ── 5. Request Validation ─────────────────────────────────────────────────────
echo -e "\n${BOLD}[Request Validation]${NC}"

request_count=0

# Find all request files (inbox + archive, both project-level and service-level)
while IFS= read -r -d '' reqfile; do
    [[ -f "$reqfile" ]] || continue
    fname=$(basename "$reqfile")
    [[ "$fname" == ".gitkeep" ]] && continue

    request_count=$((request_count + 1))
    rel=$(echo "$reqfile" | sed "s|$PROJECT_DIR/||")

    if bash "$validator_req" "$reqfile" 2>/dev/null; then
        ok "Request: $rel"
    else
        fail "Request: $rel — format errors"
        [[ "$VERBOSE" == true ]] && bash "$validator_req" "$reqfile" 2>&1 | sed 's/^/       /'
    fi
done < <(find "$PROJECT_DIR/.agent-comms" "$PROJECT_DIR"/*/.agent-comms -name "*.md" -not -name "PROTOCOL.md" -not -name "TEMPLATE.md" -print0 2>/dev/null || true)

[[ $request_count -eq 0 ]] && info "No request files found"

# ── 6. Cross-Reference Checks ────────────────────────────────────────────────
echo -e "\n${BOLD}[Cross-References]${NC}"

# Check proposed annotations have matching requests
for f in "$PROJECT_DIR/contracts"/*.yaml; do
    [[ -f "$f" ]] || continue
    while IFS= read -r line; do
        req_id=$(echo "$line" | sed 's/.*x-accord-request:[[:space:]]*//')
        # Search for matching request file
        found=$(find "$PROJECT_DIR/.agent-comms" -name "${req_id}*.md" 2>/dev/null | head -1)
        if [[ -n "$found" ]]; then
            ok "Proposed annotation '$req_id' in $(basename "$f") → request exists"
        else
            warn "Proposed annotation '$req_id' in $(basename "$f") → no matching request file found"
        fi
    done < <(grep "x-accord-request:" "$f" 2>/dev/null || true)
done

# Check request related_contract references
while IFS= read -r -d '' reqfile; do
    [[ -f "$reqfile" ]] || continue
    fname=$(basename "$reqfile")
    [[ "$fname" == ".gitkeep" || "$fname" == "PROTOCOL.md" || "$fname" == "TEMPLATE.md" ]] && continue

    related=$(grep "^related_contract:" "$reqfile" 2>/dev/null | head -1 | sed 's/related_contract:[[:space:]]*//')
    if [[ -n "$related" ]]; then
        if [[ -f "$PROJECT_DIR/$related" ]]; then
            ok "Request $fname → $related exists"
        else
            warn "Request $fname references $related but file not found"
        fi
    fi
done < <(find "$PROJECT_DIR/.agent-comms" "$PROJECT_DIR"/*/.agent-comms -name "*.md" -not -name "PROTOCOL.md" -not -name "TEMPLATE.md" -print0 2>/dev/null || true)

# ── 7. Staleness Checks ──────────────────────────────────────────────────────
echo -e "\n${BOLD}[Staleness]${NC}"

now=$(date +%s)

while IFS= read -r -d '' reqfile; do
    [[ -f "$reqfile" ]] || continue
    fname=$(basename "$reqfile")
    [[ "$fname" == ".gitkeep" || "$fname" == "PROTOCOL.md" || "$fname" == "TEMPLATE.md" ]] && continue

    status=$(grep "^status:" "$reqfile" 2>/dev/null | head -1 | sed 's/status:[[:space:]]*//')
    updated=$(grep "^updated:" "$reqfile" 2>/dev/null | head -1 | sed 's/updated:[[:space:]]*//')

    # Only check non-terminal states in inbox
    if [[ "$status" == "pending" || "$status" == "approved" || "$status" == "in-progress" ]]; then
        if [[ -n "$updated" ]]; then
            # Try to parse the date (macOS and Linux compatible)
            req_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$updated" +%s 2>/dev/null || \
                        date -d "$updated" +%s 2>/dev/null || echo "0")
            if [[ "$req_epoch" -gt 0 ]]; then
                age_days=$(( (now - req_epoch) / 86400 ))
                if [[ $age_days -gt 7 ]]; then
                    warn "Request $fname is $status for ${age_days} days (updated: $updated)"
                elif [[ $age_days -gt 3 ]]; then
                    info "Request $fname is $status for ${age_days} days"
                fi
            fi
        fi
    fi
done < <(find "$PROJECT_DIR/.agent-comms/inbox" "$PROJECT_DIR"/*/.agent-comms/inbox -name "*.md" -print0 2>/dev/null || true)

# Check for old draft contracts
for f in "$PROJECT_DIR/contracts"/*.yaml; do
    [[ -f "$f" ]] || continue
    if grep -q "x-accord-status: draft" "$f"; then
        # Use git to check age if available
        if command -v git > /dev/null 2>&1 && [[ -d "$PROJECT_DIR/.git" ]]; then
            commit_date=$(cd "$PROJECT_DIR" && git log -1 --format="%ct" -- "$f" 2>/dev/null || echo "0")
            if [[ "$commit_date" -gt 0 ]]; then
                age_days=$(( (now - commit_date) / 86400 ))
                if [[ $age_days -gt 7 ]]; then
                    warn "$(basename "$f") has been 'draft' for ${age_days} days — needs review"
                else
                    info "$(basename "$f") is draft (${age_days} days old)"
                fi
            fi
        else
            info "$(basename "$f") is still draft status"
        fi
    fi
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}=== Summary ===${NC}"
echo -e "  ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$WARN warnings${NC}"

if [[ $FAIL -gt 0 ]]; then
    echo -e "\n  Run with ${CYAN}--verbose${NC} for detailed error output."
    exit 1
fi

if [[ $WARN -gt 0 ]]; then
    exit 0
fi

echo -e "\n  ${GREEN}All checks passed!${NC}"
exit 0
