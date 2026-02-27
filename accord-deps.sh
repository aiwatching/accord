#!/usr/bin/env bash
# accord-deps — Cross-team dependency checker
#
# Checks if contracts depended on by this team have changed,
# and creates notifications in dependent teams' _team/ inboxes.
#
# Usage:
#   accord-deps.sh check --team-dir <path>          # Check for contract changes
#   accord-deps.sh check --team-dir <path> --since <commit>  # Changes since specific commit
#
# Reads teams/{team}/dependencies.yaml to find cross-team dependencies.
# Uses git diff to detect contract changes in depended-on teams.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────

SUBCOMMAND=""
TEAM_DIR=""
SINCE="HEAD~1"

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo "[accord-deps] $*"; }
warn() { echo "[accord-deps] WARNING: $*" >&2; }
err() { echo "[accord-deps] ERROR: $*" >&2; exit 1; }

yaml_val() {
    local key="$1" file="$2"
    sed -n "s/^${key}:[[:space:]]*//p" "$file" | head -1 | tr -d '"' | tr -d "'" | xargs
}

# ── Argument Parsing ─────────────────────────────────────────────────────────

parse_args() {
    [[ $# -eq 0 ]] && { echo "Usage: accord-deps.sh check --team-dir <path>"; exit 1; }

    SUBCOMMAND="$1"; shift

    case "$SUBCOMMAND" in
        check) ;;
        --help|-h) echo "Usage: accord-deps.sh check --team-dir <path> [--since <commit>]"; exit 0 ;;
        *) err "Unknown command: $SUBCOMMAND. Use 'check'." ;;
    esac

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --team-dir) TEAM_DIR="$2"; shift 2 ;;
            --since)    SINCE="$2"; shift 2 ;;
            --help)     echo "Usage: accord-deps.sh check --team-dir <path> [--since <commit>]"; exit 0 ;;
            *)          err "Unknown option: $1" ;;
        esac
    done

    if [[ -z "$TEAM_DIR" ]]; then
        err "--team-dir is required"
    fi
}

# ── Check Dependencies ──────────────────────────────────────────────────────

do_check() {
    local deps_file="$TEAM_DIR/dependencies.yaml"

    if [[ ! -f "$deps_file" ]]; then
        log "No dependencies.yaml found in $TEAM_DIR — nothing to check"
        return
    fi

    local team_name
    team_name="$(yaml_val "team" "$deps_file")"
    if [[ -z "$team_name" ]]; then
        err "Cannot determine team name from $deps_file"
    fi

    # Find the hub root (parent of teams/)
    local hub_root
    hub_root="$(cd "$TEAM_DIR/../.." && pwd)"

    if [[ ! -f "$hub_root/accord.yaml" ]]; then
        err "Cannot find hub root (expected accord.yaml at $hub_root)"
    fi

    log "Checking cross-team dependencies for team: $team_name"
    log "Hub root: $hub_root"
    log "Since: $SINCE"

    local notifications=0

    # Parse depends_on entries from dependencies.yaml
    # Format:
    #   depends_on:
    #     - team: other-team
    #       contract: some-api.yaml
    #       used_by:
    #         - svc-a
    local current_dep_team=""
    local current_dep_contract=""
    local current_used_by=""

    while IFS= read -r line; do
        # New dependency entry
        if echo "$line" | grep -q "^  - team:"; then
            # Process previous entry if any
            if [[ -n "$current_dep_team" && -n "$current_dep_contract" ]]; then
                check_contract_change "$hub_root" "$team_name" "$current_dep_team" "$current_dep_contract" "$current_used_by"
                if [[ $? -eq 0 ]]; then
                    notifications=$((notifications + 1))
                fi
            fi
            current_dep_team="$(echo "$line" | sed 's/.*team:[[:space:]]*//' | xargs)"
            current_dep_contract=""
            current_used_by=""
            continue
        fi
        if echo "$line" | grep -q "contract:"; then
            current_dep_contract="$(echo "$line" | sed 's/.*contract:[[:space:]]*//' | xargs)"
            continue
        fi
        if echo "$line" | grep -q "^      - "; then
            local svc
            svc="$(echo "$line" | sed 's/^[[:space:]]*- //' | xargs)"
            if [[ -n "$current_used_by" ]]; then
                current_used_by="$current_used_by,$svc"
            else
                current_used_by="$svc"
            fi
        fi
    done < "$deps_file"

    # Process last entry
    if [[ -n "$current_dep_team" && -n "$current_dep_contract" ]]; then
        check_contract_change "$hub_root" "$team_name" "$current_dep_team" "$current_dep_contract" "$current_used_by"
        if [[ $? -eq 0 ]]; then
            notifications=$((notifications + 1))
        fi
    fi

    if [[ $notifications -gt 0 ]]; then
        log "Created $notifications contract change notification(s)"
    else
        log "No contract changes detected in dependencies"
    fi
}

# Check if a specific contract has changed and create notification
# Returns 0 if notification was created, 1 otherwise
check_contract_change() {
    local hub_root="$1"
    local our_team="$2"
    local dep_team="$3"
    local dep_contract="$4"
    local used_by="$5"

    local contract_path="teams/$dep_team/contracts/$dep_contract"
    local full_path="$hub_root/$contract_path"

    if [[ ! -f "$full_path" ]]; then
        log "  Contract not found: $contract_path (skipping)"
        return 1
    fi

    # Check if the contract changed since $SINCE
    local changed=false
    if (cd "$hub_root" && git diff --quiet "$SINCE" -- "$contract_path" 2>/dev/null); then
        return 1  # No changes
    fi

    log "  Contract changed: $contract_path"

    # Create notification in our _team/ inbox
    local ts
    ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    local epoch
    epoch="$(date +%s)"
    local notify_id="req-contract-change-${dep_team}-${epoch}"
    local inbox_dir="$hub_root/teams/$our_team/.accord/comms/inbox/_team"
    mkdir -p "$inbox_dir"

    local notify_file="$inbox_dir/${notify_id}.md"

    local used_by_section=""
    if [[ -n "$used_by" ]]; then
        used_by_section="
Services that depend on this contract: $used_by"
    fi

    cat > "$notify_file" <<EOF
---
id: $notify_id
from: $dep_team
to: $our_team
scope: cross-team
type: other
priority: medium
status: pending
created: $ts
updated: $ts
related_contract: $contract_path
---

## What

The contract **$dep_contract** from team **$dep_team** has been modified.
$used_by_section

## Proposed Change

Review the updated contract and assess impact on your services.

## Why

Cross-team contract change notification (auto-generated by accord-deps).

## Impact

Review the changes in \`$contract_path\` and update consuming services if needed.
EOF

    log "  Created notification: $notify_id"
    return 0
}

# ── Main ─────────────────────────────────────────────────────────────────────

parse_args "$@"

case "$SUBCOMMAND" in
    check) do_check ;;
esac
