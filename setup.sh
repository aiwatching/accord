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
    SVC_REPOS=()

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

    # Ask directory and repo URL for each service
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
        read -r -p "  $svc repo URL (optional) []: " repo_input
        SVC_REPOS+=("${repo_input:-}")
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

    # 6. Agent daemons
    read -r -p "  Start agent daemons for all services? (y/N): " daemon_input
    START_DAEMONS=false
    if [[ "$daemon_input" =~ ^[Yy]$ ]]; then
        START_DAEMONS=true
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
        local repo_info=""
        if [[ -n "${SVC_REPOS[$i]:-}" ]]; then
            repo_info=" (repo: ${SVC_REPOS[$i]})"
        fi
        echo -e "    ${GREEN}${SVC_NAMES[$i]}${NC} → ${SVC_DIRS[$i]}${repo_info}"
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

    # Build service-repos mapping (name=url,name=url) for services that have repo URLs
    local service_repos_csv=""
    for i in "${!SVC_NAMES[@]}"; do
        if [[ -n "${SVC_REPOS[$i]:-}" ]]; then
            if [[ -n "$service_repos_csv" ]]; then
                service_repos_csv="${service_repos_csv},${SVC_NAMES[$i]}=${SVC_REPOS[$i]}"
            else
                service_repos_csv="${SVC_NAMES[$i]}=${SVC_REPOS[$i]}"
            fi
        fi
    done

    log "Initializing hub (orchestrator)"
    local init_args=(
        --role orchestrator
        --project-name "$PROJECT_NAME"
        --services "$services_csv"
        --adapter "$ADAPTER"
        --target-dir "$HUB_DIR"
        --no-interactive
    )
    if [[ -n "$service_repos_csv" ]]; then
        init_args+=(--service-repos "$service_repos_csv")
    fi
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

    # 4. Start agent daemons if requested
    if [[ "$START_DAEMONS" == true ]]; then
        echo ""
        log "Starting agent daemons..."
        for i in "${!SVC_NAMES[@]}"; do
            local svc="${SVC_NAMES[$i]}"
            local dir="${SVC_DIRS[$i]}"
            if [[ "$dir" != /* ]]; then dir="$project_dir/$dir"; fi
            dir="$(cd "$dir" 2>/dev/null && pwd)" || continue
            log "Starting daemon for: $svc"
            bash "$ACCORD_DIR/accord-agent.sh" start --target-dir "$dir" || {
                warn "Failed to start daemon for: $svc"
            }
        done
    fi
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
    echo "    3. (Alternative) Start headless agent daemons instead:"
    echo ""
    echo "       accord-agent.sh start-all --target-dir $HUB_DIR"
    echo -e "       ${DIM}# Or per-service:${NC}"
    for i in "${!SVC_NAMES[@]}"; do
        echo "       accord-agent.sh start --target-dir ${SVC_DIRS[$i]}"
    done
    echo ""
}

# ── Join Existing Project ────────────────────────────────────────────────────

join_project() {
    echo ""
    echo -e "${BOLD}=== Join Existing Accord Project ===${NC}"
    echo ""

    read -r -p "  Hub git URL: " JOIN_HUB_URL
    if [[ -z "$JOIN_HUB_URL" ]]; then err "Hub git URL is required"; fi

    local hub_basename
    hub_basename="$(basename "$JOIN_HUB_URL" .git)"
    local join_hub_dir="$(pwd)/$hub_basename"

    # Clone hub
    if [[ -d "$hub_basename" ]]; then
        echo -e "  ${DIM}Found existing hub directory: $hub_basename/${NC}"
        join_hub_dir="$(cd "$hub_basename" && pwd)"
        log "Pulling latest from hub..."
        (cd "$join_hub_dir" && git pull --quiet) || warn "Hub pull failed"
    else
        log "Cloning hub → $join_hub_dir"
        git clone "$JOIN_HUB_URL" "$join_hub_dir"
    fi

    # Read config.yaml to discover services
    local config_file="$join_hub_dir/config.yaml"
    if [[ ! -f "$config_file" ]]; then
        err "Hub does not have config.yaml — is this an Accord hub?"
    fi

    local project_name
    project_name="$(sed -n 's/^[[:space:]]*name:[[:space:]]*//p' "$config_file" | head -1 | xargs)"

    echo ""
    echo -e "  Project:  ${GREEN}${project_name}${NC}"
    echo -e "  Hub:      ${GREEN}${join_hub_dir}${NC}"
    echo ""

    # Parse services (and optional repo URLs) from config
    local svc_names=()
    local svc_repos=()
    local current_name=""
    while IFS= read -r line; do
        local name_match
        name_match="$(echo "$line" | sed -n 's/^[[:space:]]*- name:[[:space:]]*//p' | xargs)"
        if [[ -n "$name_match" ]]; then
            current_name="$name_match"
            svc_names+=("$current_name")
            svc_repos+=("")
            continue
        fi
        local repo_match
        repo_match="$(echo "$line" | sed -n 's/^[[:space:]]*repo:[[:space:]]*//p' | xargs)"
        if [[ -n "$repo_match" && -n "$current_name" ]]; then
            svc_repos[${#svc_repos[@]}-1]="$repo_match"
        fi
    done < "$config_file"

    if [[ ${#svc_names[@]} -eq 0 ]]; then
        err "No services found in hub config.yaml"
    fi

    echo "  Services found:"
    for i in "${!svc_names[@]}"; do
        local repo_info=""
        if [[ -n "${svc_repos[$i]}" ]]; then repo_info=" (${svc_repos[$i]})"; fi
        echo -e "    ${GREEN}${svc_names[$i]}${NC}${repo_info}"
    done
    echo ""

    # Ask which services to clone/init
    read -r -p "  Which services to set up? (comma-separated, or 'all') [all]: " svc_choice
    svc_choice="${svc_choice:-all}"

    local selected_names=()
    local selected_repos=()
    if [[ "$svc_choice" == "all" ]]; then
        selected_names=("${svc_names[@]}")
        selected_repos=("${svc_repos[@]}")
    else
        IFS=',' read -ra chosen <<< "$svc_choice"
        for c in "${chosen[@]}"; do
            c="$(echo "$c" | xargs)"
            for i in "${!svc_names[@]}"; do
                if [[ "${svc_names[$i]}" == "$c" ]]; then
                    selected_names+=("$c")
                    selected_repos+=("${svc_repos[$i]}")
                    break
                fi
            done
        done
    fi

    if [[ ${#selected_names[@]} -eq 0 ]]; then
        err "No services selected"
    fi

    # Adapter choice
    local adapter="claude-code"
    read -r -p "  Adapter [$adapter]: " input
    adapter="${input:-$adapter}"

    echo ""
    read -r -p "  Proceed to set up ${#selected_names[@]} service(s)? (Y/n): " confirm
    if [[ "${confirm:-Y}" =~ ^[Nn]$ ]]; then
        echo "  Aborted."
        exit 0
    fi

    local all_services_csv
    all_services_csv="$(IFS=','; echo "${svc_names[*]}")"

    echo ""
    echo -e "${BOLD}  ── Setting Up Services ──${NC}"
    echo ""

    for i in "${!selected_names[@]}"; do
        local svc="${selected_names[$i]}"
        local repo="${selected_repos[$i]}"
        local svc_dir="$(pwd)/$svc"

        # Clone if repo URL is available and directory doesn't exist
        if [[ -n "$repo" && ! -d "$svc" ]]; then
            log "Cloning $svc → $svc_dir"
            git clone "$repo" "$svc_dir" || { warn "Failed to clone $svc"; continue; }
        elif [[ ! -d "$svc" ]]; then
            warn "$svc: no repo URL and directory not found — skipping"
            continue
        else
            svc_dir="$(cd "$svc" && pwd)"
        fi

        # Skip if already initialized
        if [[ -f "$svc_dir/.accord/config.yaml" ]]; then
            log "$svc: already initialized (skipping)"
            continue
        fi

        log "Initializing service: $svc"
        bash "$ACCORD_DIR/init.sh" \
            --target-dir "$svc_dir" \
            --project-name "$project_name" \
            --repo-model multi-repo \
            --hub "$JOIN_HUB_URL" \
            --services "$all_services_csv" \
            --adapter "$adapter" \
            --no-interactive || {
            warn "Failed to initialize: $svc"
            continue
        }
    done

    echo ""
    echo -e "${BOLD}=== Join Complete ===${NC}"
    echo ""
    echo -e "  Project:  ${GREEN}${project_name}${NC}"
    echo -e "  Hub:      ${GREEN}${join_hub_dir}${NC}"
    echo "  Services set up: ${#selected_names[@]}"
    echo ""
    echo "  Next steps:"
    echo "    1. Commit each service repo's .accord/ changes"
    echo "    2. Start agent sessions and begin working"
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    if ! tty -s 2>/dev/null; then
        err "setup.sh requires an interactive terminal (stdin must be a tty)"
    fi

    echo ""
    echo -e "${BOLD}Accord Setup${NC}"
    echo ""
    echo "  1. Create new project"
    echo "  2. Join existing project"
    echo ""
    read -r -p "  Choice [1]: " mode_choice

    case "${mode_choice:-1}" in
        1|new)
            collect_info
            confirm_setup
            execute_setup
            print_done
            ;;
        2|join)
            join_project
            ;;
        *)
            collect_info
            confirm_setup
            execute_setup
            print_done
            ;;
    esac
}

main
