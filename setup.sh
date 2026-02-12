#!/usr/bin/env bash
# Accord Project Setup Wizard
#
# Creates a project workspace with hub + service repos, all wired up.
# Run this once to bootstrap a new multi-service project.
#
# Usage:
#   mkdir my-project && cd my-project
#   ~/.accord/setup.sh
#
# This script collects project info interactively, then calls init.sh
# to initialize the hub and each service.

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Helpers ──────────────────────────────────────────────────────────────────

log() { echo "[accord] $*"; }
warn() { echo "[accord] WARNING: $*" >&2; }
err() { echo "[accord] ERROR: $*" >&2; exit 1; }

GREEN='\033[0;32m'
DIM='\033[2m'
BOLD='\033[1m'
RED='\033[0;31m'
NC='\033[0m'

# ── Collect Info ─────────────────────────────────────────────────────────────

collect_info() {
    echo ""
    echo -e "${BOLD}=== Accord Project Setup ===${NC}"
    echo ""

    # 1. Project name
    local detected_name
    detected_name="$(basename "$(pwd)")"
    read -r -p "  Project name [$detected_name]: " input
    PROJECT_NAME="${input:-$detected_name}"

    # 2. Hub
    echo ""
    read -r -p "  Hub git URL: " HUB_URL
    if [[ -z "$HUB_URL" ]]; then err "Hub git URL is required"; fi

    # Determine hub local directory name from URL
    local hub_basename
    hub_basename="$(basename "$HUB_URL" .git)"
    local default_hub_dir="./$hub_basename"

    if [[ -d "$hub_basename" ]]; then
        echo -e "  ${DIM}Found existing directory: $hub_basename/${NC}"
        HUB_DIR="$(cd "$hub_basename" && pwd)"
        HUB_CLONE=false
    else
        HUB_DIR="$(pwd)/$hub_basename"
        HUB_CLONE=true
    fi

    # 3. Services
    echo ""
    echo "  Services — enter names (comma-separated) or one per line (empty to finish):"
    echo ""

    SVC_NAMES=()
    SVC_DIRS=()

    read -r -p "  Service names: " svc_input
    if [[ -z "$svc_input" ]]; then err "At least one service is required"; fi

    # Parse comma-separated or single
    IFS=',' read -ra _names <<< "$svc_input"
    for name in "${_names[@]}"; do
        name="$(echo "$name" | xargs)"
        if [[ -z "$name" ]]; then continue; fi
        SVC_NAMES+=("$name")
    done

    # If only one name was given, allow adding more
    if [[ ${#SVC_NAMES[@]} -eq 1 ]]; then
        while true; do
            read -r -p "  Add another service (empty to finish): " more
            more="$(echo "$more" | xargs)"
            if [[ -z "$more" ]]; then break; fi
            SVC_NAMES+=("$more")
        done
    fi

    # Ask directory for each service
    echo ""
    for svc in "${SVC_NAMES[@]}"; do
        local default_dir="./$svc"
        if [[ -d "$svc" ]]; then
            echo -e "  ${DIM}Found: $svc/${NC}"
            read -r -p "  $svc directory [$default_dir]: " dir_input
            SVC_DIRS+=("${dir_input:-$default_dir}")
        else
            read -r -p "  $svc directory [$default_dir]: " dir_input
            SVC_DIRS+=("${dir_input:-$default_dir}")
        fi
    done

    # 4. Adapter
    echo ""
    ADAPTER="claude-code"
    read -r -p "  Adapter [$ADAPTER]: " input
    ADAPTER="${input:-$ADAPTER}"

    # 5. Auto-scan
    read -r -p "  Auto-scan source code for contracts? (y/N): " scan_input
    SCAN=false
    if [[ "$scan_input" =~ ^[Yy]$ ]]; then
        SCAN=true
    fi
}

# ── Confirm ──────────────────────────────────────────────────────────────────

confirm_setup() {
    echo ""
    echo -e "${BOLD}  ── Summary ──${NC}"
    echo ""
    echo -e "  Project:   ${GREEN}$PROJECT_NAME${NC}"
    echo -e "  Hub:       ${GREEN}$HUB_URL${NC}"
    if [[ "$HUB_CLONE" == true ]]; then
        echo -e "             → clone to ${GREEN}$HUB_DIR${NC}"
    else
        echo -e "             → existing ${GREEN}$HUB_DIR${NC}"
    fi
    echo -e "  Adapter:   ${GREEN}$ADAPTER${NC}"
    echo -e "  Services:"
    for i in "${!SVC_NAMES[@]}"; do
        echo -e "    ${GREEN}${SVC_NAMES[$i]}${NC} → ${SVC_DIRS[$i]}"
    done
    echo ""

    read -r -p "  Proceed? (Y/n): " confirm
    if [[ "${confirm:-Y}" =~ ^[Nn]$ ]]; then
        echo "  Aborted."
        exit 0
    fi
}

# ── Execute ──────────────────────────────────────────────────────────────────

execute_setup() {
    echo ""
    echo -e "${BOLD}  ── Initializing ──${NC}"
    echo ""

    local project_dir
    project_dir="$(pwd)"

    # 1. Clone hub if needed
    if [[ "$HUB_CLONE" == true ]]; then
        log "Cloning hub → $HUB_DIR"
        git clone "$HUB_URL" "$HUB_DIR"
    fi

    # 2. Init hub as orchestrator
    local services_csv
    services_csv="$(IFS=','; echo "${SVC_NAMES[*]}")"

    log "Initializing hub (orchestrator)"
    local init_args=(
        --role orchestrator
        --project-name "$PROJECT_NAME"
        --services "$services_csv"
        --adapter "$ADAPTER"
        --target-dir "$HUB_DIR"
        --no-interactive
    )
    bash "$ACCORD_DIR/init.sh" "${init_args[@]}"

    # 3. Init each service
    for i in "${!SVC_NAMES[@]}"; do
        local svc="${SVC_NAMES[$i]}"
        local dir="${SVC_DIRS[$i]}"

        # Resolve relative paths
        if [[ "$dir" != /* ]]; then dir="$project_dir/$dir"; fi
        # Normalize (remove trailing ./ prefix artifacts)
        dir="$(cd "$dir" 2>/dev/null && pwd)" || {
            warn "Directory not found: ${SVC_DIRS[$i]} (skipping $svc)"
            continue
        }

        log "Initializing service: $svc → $dir"

        local svc_args=(
            --target-dir "$dir"
            --project-name "$PROJECT_NAME"
            --repo-model multi-repo
            --hub "$HUB_URL"
            --services "$services_csv"
            --adapter "$ADAPTER"
            --no-interactive
        )
        if [[ "$SCAN" == true ]]; then
            svc_args+=(--scan)
        fi

        bash "$ACCORD_DIR/init.sh" "${svc_args[@]}" || {
            warn "Failed to initialize: $svc"
            continue
        }
    done
}

# ── Summary ──────────────────────────────────────────────────────────────────

print_done() {
    echo ""
    echo -e "${BOLD}=== Setup Complete ===${NC}"
    echo ""
    echo -e "  Project:  ${GREEN}$PROJECT_NAME${NC}"
    echo -e "  Hub:      ${GREEN}$HUB_DIR${NC}"
    echo ""
    echo "  Next steps:"
    echo ""
    echo "    1. Commit each repo:"
    echo ""
    echo "       cd $HUB_DIR"
    echo "       git add . && git commit -m 'accord: init hub' && git push"
    echo ""
    for i in "${!SVC_NAMES[@]}"; do
        local dir="${SVC_DIRS[$i]}"
        echo "       cd $dir"
        echo "       git add .accord CLAUDE.md .claude && git commit -m 'accord: init' && git push"
        echo ""
    done
    echo "    2. Open a terminal for each repo and start your agent:"
    echo ""
    echo -e "       ${DIM}# Hub (orchestrator)${NC}"
    echo "       cd $HUB_DIR && claude"
    echo ""
    for i in "${!SVC_NAMES[@]}"; do
        echo -e "       ${DIM}# ${SVC_NAMES[$i]}${NC}"
        echo "       cd ${SVC_DIRS[$i]} && claude"
    done
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    if ! tty -s 2>/dev/null; then
        err "setup.sh requires an interactive terminal (stdin must be a tty)"
    fi

    collect_info
    confirm_setup
    execute_setup
    print_done
}

main
