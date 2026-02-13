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

if [[ -d "$PROJECT_DIR/.accord/contracts" ]]; then
    count=$(find "$PROJECT_DIR/.accord/contracts" -maxdepth 1 -name "*.yaml" -type f | wc -l | xargs)
    ok ".accord/contracts/ directory exists ($count contract files)"
else
    fail ".accord/contracts/ directory not found"
fi

if [[ -d "$PROJECT_DIR/.accord/comms" ]]; then
    ok ".accord/comms/ directory exists"
else
    fail ".accord/comms/ directory not found"
fi

if [[ -f "$PROJECT_DIR/.accord/comms/PROTOCOL.md" ]]; then
    ok ".accord/comms/PROTOCOL.md exists"
else
    warn ".accord/comms/PROTOCOL.md missing — agents won't have protocol reference"
fi

if [[ -f "$PROJECT_DIR/.accord/comms/TEMPLATE.md" ]]; then
    ok ".accord/comms/TEMPLATE.md exists"
else
    warn ".accord/comms/TEMPLATE.md missing — agents won't have request template"
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

    # Check each service/module has a contract file and inbox
    # Modules (type: module) have internal contracts; services have external contracts
    if grep -q "^services:" "$config"; then
        services=$(grep "^  - name:" "$config" | sed 's/.*name:[[:space:]]*//')

        # Build list of module names (entries with "type: module")
        module_names=""
        while IFS= read -r line; do
            if echo "$line" | grep -q "^  - name:"; then
                current_name="$(echo "$line" | sed 's/.*name:[[:space:]]*//')"
            fi
            if echo "$line" | grep -q "type: module"; then
                module_names="$module_names $current_name"
            fi
        done < "$config"

        for svc in $services; do
            # Check if this is a module (type: module)
            if echo "$module_names" | grep -qw "$svc"; then
                # Module: check internal contract
                if [[ -f "$PROJECT_DIR/.accord/contracts/internal/${svc}.md" ]]; then
                    ok "Module '$svc' has internal contract"
                else
                    fail "Module '$svc' missing contract: .accord/contracts/internal/${svc}.md"
                fi
            else
                # Service: check external contract
                if [[ -f "$PROJECT_DIR/.accord/contracts/${svc}.yaml" ]]; then
                    ok "Service '$svc' has contract file"
                else
                    fail "Service '$svc' missing contract: .accord/contracts/${svc}.yaml"
                fi
            fi

            if [[ -d "$PROJECT_DIR/.accord/comms/inbox/${svc}" ]]; then
                ok "'$svc' has inbox directory"
            else
                fail "'$svc' missing inbox: .accord/comms/inbox/${svc}/"
            fi
        done
    else
        warn "No services defined in config"
    fi
fi

# ── 4. Contract Validation ────────────────────────────────────────────────────
echo -e "\n${BOLD}[Contract Validation]${NC}"

validator_ext="$ACCORD_DIR/protocol/scan/validators/validate-openapi.sh"
validator_int="$ACCORD_DIR/protocol/scan/validators/validate-internal.sh"
validator_req="$ACCORD_DIR/protocol/scan/validators/validate-request.sh"

# External contracts
for f in "$PROJECT_DIR/.accord/contracts"/*.yaml; do
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
for f in "$PROJECT_DIR/.accord/contracts/internal"/*.md; do
    [[ -f "$f" ]] || continue
    # Skip template placeholders
    if grep -q "{{" "$f"; then
        info "Skipping template: $f"
        continue
    fi
    fname=$(basename "$f")
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

# Find all request files in .accord/comms/
if [[ -d "$PROJECT_DIR/.accord/comms" ]]; then
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
    done < <(find "$PROJECT_DIR/.accord/comms/inbox" "$PROJECT_DIR/.accord/comms/archive" -name "*.md" -not -name "PROTOCOL.md" -not -name "TEMPLATE.md" -print0 2>/dev/null || true)
fi

[[ $request_count -eq 0 ]] && info "No request files found"

# ── 6. Cross-Reference Checks ────────────────────────────────────────────────
echo -e "\n${BOLD}[Cross-References]${NC}"

# Check proposed annotations have matching requests
for f in "$PROJECT_DIR/.accord/contracts"/*.yaml; do
    [[ -f "$f" ]] || continue
    while IFS= read -r line; do
        req_id=$(echo "$line" | sed 's/.*x-accord-request:[[:space:]]*//')
        # Search for matching request file
        found=$(find "$PROJECT_DIR/.accord/comms" -name "${req_id}*.md" 2>/dev/null | head -1)
        if [[ -n "$found" ]]; then
            ok "Proposed annotation '$req_id' in $(basename "$f") → request exists"
        else
            warn "Proposed annotation '$req_id' in $(basename "$f") → no matching request file found"
        fi
    done < <(grep "x-accord-request:" "$f" 2>/dev/null || true)
done

# Check request related_contract references
if [[ -d "$PROJECT_DIR/.accord/comms" ]]; then
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
    done < <(find "$PROJECT_DIR/.accord/comms" -name "*.md" -not -name "PROTOCOL.md" -not -name "TEMPLATE.md" -print0 2>/dev/null || true)
fi

# ── 7. Staleness Checks ──────────────────────────────────────────────────────
echo -e "\n${BOLD}[Staleness]${NC}"

now=$(date +%s)

if [[ -d "$PROJECT_DIR/.accord/comms/inbox" ]]; then
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
    done < <(find "$PROJECT_DIR/.accord/comms/inbox" -name "*.md" -print0 2>/dev/null || true)
fi

# Check for old draft contracts
for f in "$PROJECT_DIR/.accord/contracts"/*.yaml; do
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

# ── 8. v2 Multi-Team Checks ──────────────────────────────────────────────────

# Check v2 hub structure
if [[ -f "$PROJECT_DIR/accord.yaml" ]]; then
    echo -e "\n${BOLD}[v2 Hub Structure]${NC}"
    ok "accord.yaml exists (v2 hub)"

    # Check for teams
    team_dirs=()
    if [[ -d "$PROJECT_DIR/teams" ]]; then
        for td in "$PROJECT_DIR/teams"/*/; do
            [[ -d "$td" ]] || continue
            team_dirs+=("$td")
        done
    fi

    if [[ ${#team_dirs[@]} -gt 0 ]]; then
        ok "Found ${#team_dirs[@]} team(s)"
        for td in "${team_dirs[@]}"; do
            team_name="$(basename "$td")"

            if [[ -f "$td/config.yaml" ]]; then
                ok "Team '$team_name': config.yaml exists"
            else
                fail "Team '$team_name': missing config.yaml"
            fi

            if [[ -f "$td/dependencies.yaml" ]]; then
                ok "Team '$team_name': dependencies.yaml exists"
            else
                warn "Team '$team_name': missing dependencies.yaml"
            fi

            if [[ -d "$td/registry" ]]; then
                reg_count=0
                for rf in "$td/registry"/*.yaml; do
                    [[ -f "$rf" ]] || continue
                    reg_count=$((reg_count + 1))
                    # Validate each registry YAML
                    validator_reg="$ACCORD_DIR/protocol/scan/validators/validate-registry-yaml.sh"
                    if [[ -f "$validator_reg" ]]; then
                        reg_fname="$(basename "$rf")"
                        if bash "$validator_reg" "$rf" 2>/dev/null; then
                            ok "Team '$team_name': registry/$reg_fname valid"
                        else
                            fail "Team '$team_name': registry/$reg_fname has errors"
                            [[ "$VERBOSE" == true ]] && bash "$validator_reg" "$rf" 2>&1 | sed 's/^/       /'
                        fi
                    fi
                done
                if [[ $reg_count -eq 0 ]]; then
                    warn "Team '$team_name': registry/ has no YAML files"
                fi
            else
                warn "Team '$team_name': missing registry/ directory"
            fi

            if [[ -d "$td/comms/inbox" ]]; then
                ok "Team '$team_name': comms/inbox exists"
                if [[ -d "$td/comms/inbox/_team" ]]; then
                    ok "Team '$team_name': _team/ inbox exists"
                else
                    warn "Team '$team_name': missing _team/ inbox for cross-team requests"
                fi
            else
                fail "Team '$team_name': missing comms/inbox/"
            fi
        done
    else
        fail "No team directories found under teams/"
    fi
fi

# Check v2 service structure
if [[ -f "$PROJECT_DIR/.accord/service.yaml" ]]; then
    echo -e "\n${BOLD}[v2 Service Structure]${NC}"
    ok ".accord/service.yaml exists (v2 service)"

    validator_svc="$ACCORD_DIR/protocol/scan/validators/validate-service-yaml.sh"
    if [[ -f "$validator_svc" ]]; then
        if bash "$validator_svc" "$PROJECT_DIR/.accord/service.yaml" 2>/dev/null; then
            ok "service.yaml is valid"
        else
            fail "service.yaml has errors"
            [[ "$VERBOSE" == true ]] && bash "$validator_svc" "$PROJECT_DIR/.accord/service.yaml" 2>&1 | sed 's/^/       /'
        fi
    fi

    # Check hub clone
    if [[ -d "$PROJECT_DIR/.accord/.hub" ]]; then
        hub_found=false
        for hd in "$PROJECT_DIR/.accord/.hub"/*/; do
            if [[ -d "$hd/.git" ]]; then
                hub_found=true
                ok "Hub clone found: $(basename "$hd")"
                break
            fi
        done
        if [[ "$hub_found" == false ]]; then
            fail "No hub clone found in .accord/.hub/"
        fi
    else
        fail ".accord/.hub/ directory not found — run init with --v2"
    fi
fi

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
