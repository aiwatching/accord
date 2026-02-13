#!/usr/bin/env bash
# Accord Project Setup Wizard
#
# Creates a project workspace with hub + service repos, all wired up.
# Run this once to bootstrap a new multi-service project.
#
# Usage:
#   mkdir my-project && cd my-project
#   ~/.accord/setup.sh             # New project or overwrite existing
#   ~/.accord/setup.sh --force     # Clean re-init: deletes .accord/ in all services
#
# Default: re-running overwrites config/adapters but preserves .accord/ structure.
# --force: deletes .accord/ in every service directory and hub stale files,
#          then regenerates everything from scratch.
#
# This script collects project info interactively, then calls init.sh
# to initialize the hub and each service.

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")" && pwd)"
FORCE=false

# ── Helpers ──────────────────────────────────────────────────────────────────

log() { echo "[accord] $*"; }
warn() { echo "[accord] WARNING: $*" >&2; }
err() { echo "[accord] ERROR: $*" >&2; exit 1; }

validate_project_name() {
    local name="$1"
    if [[ ! "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; then
        echo -e "  ${RED}Invalid project name: '$name'${NC}"
        echo "  Must start with a letter or digit, then only letters, digits, dots, underscores, or hyphens."
        echo "  (Used as git branch: accord/$name)"
        return 1
    fi
    if [[ "$name" == *.lock || "$name" == *.. || "$name" == *. ]]; then
        echo -e "  ${RED}Invalid project name: '$name'${NC}"
        echo "  Cannot end with '.lock', '..', or '.'."
        return 1
    fi
    return 0
}

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

    # 1. Project name (hub name, used as git branch: accord/<name>)
    local detected_name
    detected_name="$(basename "$(pwd)")"
    while true; do
        read -r -p "  Hub name [$detected_name]: " input
        PROJECT_NAME="${input:-$detected_name}"
        if validate_project_name "$PROJECT_NAME"; then
            break
        fi
        echo ""
    done

    # 2. Hub git URL
    echo ""
    read -r -p "  Hub git URL: " HUB_URL
    if [[ -z "$HUB_URL" ]]; then err "Hub git URL is required"; fi

    # Determine hub local directory name from URL
    local hub_basename
    hub_basename="$(basename "$HUB_URL" .git)"

    if [[ -d "$hub_basename" ]]; then
        echo -e "  ${DIM}Found existing directory: $hub_basename/${NC}"
        HUB_DIR="$(cd "$hub_basename" && pwd)"
        HUB_CLONE=false
    else
        HUB_DIR="$(pwd)/$hub_basename"
        HUB_CLONE=true
    fi

    # 3. Team name (defaults to project name)
    echo ""
    local default_team
    default_team="$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"
    read -r -p "  Team name [$default_team]: " input
    TEAM_NAME="${input:-$default_team}"

    # 4. Services
    echo ""
    echo "  Services — enter names (comma-separated) or one per line (empty to finish):"
    echo ""

    SVC_NAMES=()
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

    # Ask repo URL for each service
    echo ""
    for svc in "${SVC_NAMES[@]}"; do
        read -r -p "  $svc repo URL (optional) []: " repo_input
        SVC_REPOS+=("${repo_input:-}")
    done

    # 5. Adapter
    echo ""
    ADAPTER="claude-code"
    read -r -p "  Adapter [$ADAPTER]: " input
    ADAPTER="${input:-$ADAPTER}"

    # 6. Auto-scan
    read -r -p "  Auto-scan source code for contracts? (y/N): " scan_input
    SCAN=false
    if [[ "$scan_input" =~ ^[Yy]$ ]]; then
        SCAN=true
    fi

    # 7. Agent daemons
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
    echo -e "  Hub:       ${GREEN}$PROJECT_NAME${NC}"
    echo -e "  Hub URL:   ${GREEN}$HUB_URL${NC}"
    if [[ "$HUB_CLONE" == true ]]; then
        echo -e "             → clone to ${GREEN}$HUB_DIR${NC}"
    else
        echo -e "             → existing ${GREEN}$HUB_DIR${NC}"
    fi
    echo -e "  Team:      ${GREEN}$TEAM_NAME${NC}"
    echo -e "  Adapter:   ${GREEN}$ADAPTER${NC}"
    echo -e "  Services:"
    for i in "${!SVC_NAMES[@]}"; do
        local repo_info=""
        if [[ -n "${SVC_REPOS[$i]:-}" ]]; then
            repo_info=" (${SVC_REPOS[$i]})"
        fi
        echo -e "    ${GREEN}${SVC_NAMES[$i]}${NC}${repo_info}"
    done
    echo ""
    echo "  Hub structure:"
    echo "    accord.yaml"
    echo "    teams/$TEAM_NAME/"
    echo "      ├── config.yaml"
    echo "      ├── dependencies.yaml"
    echo "      ├── registry/{service}.yaml"
    echo "      ├── contracts/"
    echo "      ├── directives/"
    echo "      ├── skills/"
    echo "      └── comms/inbox/{service}/ + _team/"
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

    # 0. Stop running agent daemon before re-init
    local stopped_any=false
    local hub_abs
    hub_abs="$(cd "$HUB_DIR" 2>/dev/null && pwd)" || hub_abs="$HUB_DIR"
    for check_dir in "$hub_abs" "${SVC_NAMES[@]}"; do
        # Resolve to absolute path
        if [[ "$check_dir" != /* ]]; then check_dir="$project_dir/$check_dir"; fi
        check_dir="$(cd "$check_dir" 2>/dev/null && pwd)" || continue
        local pf="$check_dir/.accord/.agent.pid"
        if [[ -f "$pf" ]]; then
            local pid
            pid="$(cat "$pf")"
            if kill -0 "$pid" 2>/dev/null; then
                log "Stopping agent daemon (pid $pid)"
                bash "$ACCORD_DIR/accord-agent.sh" stop --target-dir "$check_dir" 2>/dev/null || true
                stopped_any=true
            fi
        fi
    done
    if [[ "$stopped_any" == true ]]; then
        log "Agent daemon(s) stopped"
    fi

    # 1. Clone hub if needed
    local hub_branch="accord/${PROJECT_NAME}"
    if [[ "$HUB_CLONE" == true ]]; then
        log "Cloning hub → $HUB_DIR"
        git clone "$HUB_URL" "$HUB_DIR"
    fi

    # Checkout project branch
    if [[ -d "$HUB_DIR/.git" ]]; then
        if (cd "$HUB_DIR" && git rev-parse --verify "origin/$hub_branch" >/dev/null 2>&1); then
            log "Checking out project branch: $hub_branch"
            (cd "$HUB_DIR" && git checkout "$hub_branch" 2>/dev/null) || \
            (cd "$HUB_DIR" && git checkout -b "$hub_branch" "origin/$hub_branch" 2>/dev/null) || true
        else
            log "Creating project branch: $hub_branch"
            (cd "$HUB_DIR" && git checkout -b "$hub_branch" 2>/dev/null) || true
        fi
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
        --v2
        --role orchestrator
        --project-name "$PROJECT_NAME"
        --team "$TEAM_NAME"
        --services "$services_csv"
        --adapter "$ADAPTER"
        --target-dir "$HUB_DIR"
        --no-interactive
        --force
    )
    if [[ -n "$service_repos_csv" ]]; then
        init_args+=(--service-repos "$service_repos_csv")
    fi
    bash "$ACCORD_DIR/init.sh" "${init_args[@]}"

    # 3. Init each service
    for i in "${!SVC_NAMES[@]}"; do
        local svc="${SVC_NAMES[$i]}"
        local repo="${SVC_REPOS[$i]:-}"
        local svc_dir="$project_dir/$svc"

        # Clone if repo URL is available and directory doesn't exist
        if [[ -n "$repo" && ! -d "$svc_dir" ]]; then
            log "Cloning $svc → $svc_dir"
            git clone "$repo" "$svc_dir" || { warn "Failed to clone $svc"; continue; }
        elif [[ ! -d "$svc_dir" ]]; then
            warn "$svc: no repo URL and directory not found — skipping"
            continue
        fi

        svc_dir="$(cd "$svc_dir" && pwd)"

        # --force: delete .accord/ entirely for a clean slate
        if [[ "$FORCE" == true && -d "$svc_dir/.accord" ]]; then
            log "Removing $svc_dir/.accord/ (clean re-init)"
            rm -rf "$svc_dir/.accord"
        fi

        log "Initializing service: $svc → $svc_dir"

        local svc_args=(
            --v2
            --target-dir "$svc_dir"
            --project-name "$PROJECT_NAME"
            --team "$TEAM_NAME"
            --hub "$HUB_URL"
            --services "$services_csv"
            --adapter "$ADAPTER"
            --no-interactive
            --force
        )
        if [[ "$SCAN" == true ]]; then
            svc_args+=(--scan)
        fi

        bash "$ACCORD_DIR/init.sh" "${svc_args[@]}" || {
            warn "Failed to initialize: $svc"
            continue
        }
    done

    # 4. Start agent daemon if requested (single process monitors all services)
    if [[ "$START_DAEMONS" == true ]]; then
        echo ""
        log "Starting agent daemon..."
        local hub_abs
        hub_abs="$(cd "$HUB_DIR" 2>/dev/null && pwd)" || hub_abs="$HUB_DIR"
        bash "$ACCORD_DIR/accord-agent.sh" start --target-dir "$hub_abs" || {
            warn "Failed to start agent daemon"
        }
    fi
}

# ── Summary ──────────────────────────────────────────────────────────────────

print_done() {
    echo ""
    echo -e "${BOLD}=== Setup Complete ===${NC}"
    echo ""
    echo -e "  Hub:   ${GREEN}$PROJECT_NAME${NC}"
    echo -e "  Team:  ${GREEN}$TEAM_NAME${NC}"
    echo -e "  Dir:   ${GREEN}$HUB_DIR${NC}"
    echo ""
    echo "  Next steps:"
    echo ""
    echo "    1. Commit each repo:"
    echo ""
    echo "       cd $HUB_DIR"
    echo "       git add . && git commit -m 'accord: init hub' && git push"
    echo ""
    for svc in "${SVC_NAMES[@]}"; do
        echo "       cd $svc"
        echo "       git add .accord CLAUDE.md .claude && git commit -m 'accord: init' && git push"
        echo ""
    done
    echo "    2. Open a terminal for each repo and start your agent:"
    echo ""
    echo -e "       ${DIM}# Hub (orchestrator)${NC}"
    echo "       cd $HUB_DIR && claude"
    echo ""
    for svc in "${SVC_NAMES[@]}"; do
        echo -e "       ${DIM}# $svc${NC}"
        echo "       cd $svc && claude"
    done
    echo ""
    echo "    3. (Alternative) Start the autonomous agent daemon:"
    echo ""
    echo "       accord-agent.sh start --target-dir $HUB_DIR"
    echo -e "       ${DIM}# Single process, monitors all service inboxes${NC}"
    echo ""
    echo -e "       ${DIM}# Check status:${NC}"
    echo "       accord-agent.sh status --target-dir $HUB_DIR"
    echo ""
    echo -e "       ${DIM}# Stop:${NC}"
    echo "       accord-agent.sh stop --target-dir $HUB_DIR"
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

    # Read project name from config.yaml to determine branch
    local config_file="$join_hub_dir/config.yaml"
    local project_name=""

    # Try reading config from default branch first to get project name
    if [[ -f "$config_file" ]]; then
        project_name="$(sed -n 's/^[[:space:]]*name:[[:space:]]*//p' "$config_file" | head -1 | xargs)"
    fi

    # If no config on default branch, ask user for project name to find the branch
    if [[ -z "$project_name" ]]; then
        echo ""
        read -r -p "  Project name (needed to find the accord branch): " project_name
        if [[ -z "$project_name" ]]; then
            err "Project name is required to find the correct hub branch"
        fi
    fi

    # Checkout project branch (accord/<project-name>)
    local join_branch="accord/${project_name}"
    if (cd "$join_hub_dir" && git rev-parse --verify "origin/$join_branch" >/dev/null 2>&1); then
        log "Checking out project branch: $join_branch"
        (cd "$join_hub_dir" && git checkout "$join_branch" 2>/dev/null) || \
        (cd "$join_hub_dir" && git checkout -b "$join_branch" "origin/$join_branch" 2>/dev/null) || true
    else
        # Fallback: maybe the hub uses the default branch (pre-v2 project)
        warn "Branch '$join_branch' not found on remote. Using default branch."
    fi

    # Re-read config after branch checkout (the right branch may have different content)
    if [[ ! -f "$config_file" ]]; then
        err "Hub does not have config.yaml — is this an Accord hub?"
    fi

    project_name="$(sed -n 's/^[[:space:]]*name:[[:space:]]*//p' "$config_file" | head -1 | xargs)"

    echo ""
    echo -e "  Project:  ${GREEN}${project_name}${NC}"
    echo -e "  Hub:      ${GREEN}${join_hub_dir}${NC} (branch: ${join_branch})"
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

        # --force: delete .accord/ for clean re-init
        if [[ "$FORCE" == true && -d "$svc_dir/.accord" ]]; then
            log "Removing $svc_dir/.accord/ (clean re-init)"
            rm -rf "$svc_dir/.accord"
        elif [[ "$FORCE" != true && -f "$svc_dir/.accord/config.yaml" ]]; then
            # Default without --force in join mode: skip already initialized
            log "$svc: already initialized (skipping — use --force to re-init)"
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
            --no-interactive \
            --force || {
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

# ── v2 Multi-Team Setup ──────────────────────────────────────────────────────

collect_info_v2() {
    echo ""
    echo -e "${BOLD}=== Accord v2 Multi-Team Project Setup ===${NC}"
    echo ""

    # 1. Org name
    local detected_name
    detected_name="$(basename "$(pwd)")"
    read -r -p "  Organization name [$detected_name]: " input
    V2_ORG="${input:-$detected_name}"

    # 2. Team name
    echo ""
    read -r -p "  Team name: " V2_TEAM
    if [[ -z "$V2_TEAM" ]]; then err "Team name is required"; fi

    # 3. Project name (defaults to team name)
    read -r -p "  Project name [$V2_TEAM]: " input
    V2_PROJECT="${input:-$V2_TEAM}"
    if ! validate_project_name "$V2_PROJECT"; then
        err "Invalid project name"
    fi

    # 4. Hub
    echo ""
    read -r -p "  Hub git URL: " V2_HUB_URL
    if [[ -z "$V2_HUB_URL" ]]; then err "Hub git URL is required"; fi

    local hub_basename
    hub_basename="$(basename "$V2_HUB_URL" .git)"
    if [[ -d "$hub_basename" ]]; then
        echo -e "  ${DIM}Found existing directory: $hub_basename/${NC}"
        V2_HUB_DIR="$(cd "$hub_basename" && pwd)"
        V2_HUB_CLONE=false
    else
        V2_HUB_DIR="$(pwd)/$hub_basename"
        V2_HUB_CLONE=true
    fi

    # 5. Services
    echo ""
    echo "  Services (comma-separated):"
    read -r -p "  Service names: " svc_input
    if [[ -z "$svc_input" ]]; then err "At least one service is required"; fi

    V2_SVC_NAMES=()
    V2_SVC_REPOS=()
    IFS=',' read -ra _names <<< "$svc_input"
    for name in "${_names[@]}"; do
        name="$(echo "$name" | xargs)"
        if [[ -n "$name" ]]; then V2_SVC_NAMES+=("$name"); fi
    done

    echo ""
    for svc in "${V2_SVC_NAMES[@]}"; do
        read -r -p "  $svc repo URL (optional) []: " repo_input
        V2_SVC_REPOS+=("${repo_input:-}")
    done

    # 6. Adapter
    echo ""
    V2_ADAPTER="claude-code"
    read -r -p "  Adapter [$V2_ADAPTER]: " input
    V2_ADAPTER="${input:-$V2_ADAPTER}"
}

confirm_setup_v2() {
    echo ""
    echo -e "${BOLD}  ── Summary (v2 Multi-Team) ──${NC}"
    echo ""
    echo -e "  Organization: ${GREEN}$V2_ORG${NC}"
    echo -e "  Team:         ${GREEN}$V2_TEAM${NC}"
    echo -e "  Project:      ${GREEN}$V2_PROJECT${NC}"
    echo -e "  Hub:          ${GREEN}$V2_HUB_URL${NC}"
    echo -e "  Adapter:      ${GREEN}$V2_ADAPTER${NC}"
    echo -e "  Services:"
    for i in "${!V2_SVC_NAMES[@]}"; do
        local repo_info=""
        if [[ -n "${V2_SVC_REPOS[$i]:-}" ]]; then
            repo_info=" (repo: ${V2_SVC_REPOS[$i]})"
        fi
        echo -e "    ${GREEN}${V2_SVC_NAMES[$i]}${NC}${repo_info}"
    done
    echo ""
    echo "  Hub structure:"
    echo "    accord.yaml"
    echo "    teams/$V2_TEAM/"
    echo "      ├── config.yaml"
    echo "      ├── dependencies.yaml"
    echo "      ├── registry/{service}.yaml"
    echo "      ├── contracts/"
    echo "      ├── directives/"
    echo "      ├── skills/"
    echo "      └── comms/inbox/{service}/ + _team/"
    echo ""

    read -r -p "  Proceed? (Y/n): " confirm
    if [[ "${confirm:-Y}" =~ ^[Nn]$ ]]; then
        echo "  Aborted."
        exit 0
    fi
}

execute_setup_v2() {
    echo ""
    echo -e "${BOLD}  ── Initializing v2 Hub ──${NC}"
    echo ""

    # Clone hub if needed
    if [[ "$V2_HUB_CLONE" == true ]]; then
        log "Cloning hub → $V2_HUB_DIR"
        git clone "$V2_HUB_URL" "$V2_HUB_DIR"
    fi

    local services_csv
    services_csv="$(IFS=','; echo "${V2_SVC_NAMES[*]}")"

    # Build service-repos mapping
    local service_repos_csv=""
    for i in "${!V2_SVC_NAMES[@]}"; do
        if [[ -n "${V2_SVC_REPOS[$i]:-}" ]]; then
            if [[ -n "$service_repos_csv" ]]; then
                service_repos_csv="${service_repos_csv},${V2_SVC_NAMES[$i]}=${V2_SVC_REPOS[$i]}"
            else
                service_repos_csv="${V2_SVC_NAMES[$i]}=${V2_SVC_REPOS[$i]}"
            fi
        fi
    done

    # Init hub as v2 orchestrator
    local init_args=(
        --v2
        --role orchestrator
        --project-name "$V2_PROJECT"
        --org "$V2_ORG"
        --team "$V2_TEAM"
        --services "$services_csv"
        --adapter "$V2_ADAPTER"
        --target-dir "$V2_HUB_DIR"
        --no-interactive
        --force
    )
    if [[ -n "$service_repos_csv" ]]; then
        init_args+=(--service-repos "$service_repos_csv")
    fi
    bash "$ACCORD_DIR/init.sh" "${init_args[@]}"

    # Init each service (clone if repo URL given)
    local project_dir
    project_dir="$(pwd)"
    for i in "${!V2_SVC_NAMES[@]}"; do
        local svc="${V2_SVC_NAMES[$i]}"
        local repo="${V2_SVC_REPOS[$i]:-}"
        local svc_dir="$project_dir/$svc"

        if [[ -n "$repo" && ! -d "$svc" ]]; then
            log "Cloning $svc → $svc_dir"
            git clone "$repo" "$svc_dir" || { warn "Failed to clone $svc"; continue; }
        elif [[ ! -d "$svc" ]]; then
            warn "$svc: no repo URL and directory not found — skipping"
            continue
        else
            svc_dir="$(cd "$svc" && pwd)"
        fi

        if [[ "$FORCE" == true && -d "$svc_dir/.accord" ]]; then
            rm -rf "$svc_dir/.accord"
        fi

        log "Initializing v2 service: $svc"
        bash "$ACCORD_DIR/init.sh" \
            --v2 \
            --target-dir "$svc_dir" \
            --project-name "$V2_PROJECT" \
            --team "$V2_TEAM" \
            --hub "$V2_HUB_URL" \
            --services "$services_csv" \
            --adapter "$V2_ADAPTER" \
            --no-interactive \
            --force || {
            warn "Failed to initialize: $svc"
            continue
        }
    done
}

print_done_v2() {
    echo ""
    echo -e "${BOLD}=== v2 Multi-Team Setup Complete ===${NC}"
    echo ""
    echo -e "  Organization: ${GREEN}$V2_ORG${NC}"
    echo -e "  Team:         ${GREEN}$V2_TEAM${NC}"
    echo -e "  Hub:          ${GREEN}$V2_HUB_DIR${NC}"
    echo ""
    echo "  Next steps:"
    echo ""
    echo "    1. Commit hub:"
    echo "       cd $V2_HUB_DIR && git add . && git commit -m 'accord: init v2 hub' && git push"
    echo ""
    for i in "${!V2_SVC_NAMES[@]}"; do
        echo "       cd ${V2_SVC_NAMES[$i]} && git add .accord && git commit -m 'accord: init v2 service'"
    done
    echo ""
    echo "    2. Start agent sessions or the autonomous daemon"
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    # Parse CLI args
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --force) FORCE=true; shift ;;
            *) shift ;;
        esac
    done

    if ! tty -s 2>/dev/null; then
        err "setup.sh requires an interactive terminal (stdin must be a tty)"
    fi

    if [[ "$FORCE" == true ]]; then
        echo ""
        echo -e "${RED}[--force] Clean re-init: .accord/ will be deleted and regenerated in all services${NC}"
    fi

    echo ""
    echo -e "${BOLD}Accord Setup${NC}"
    echo ""
    echo "  1. Create new project (v1 hub-and-spoke)"
    echo "  2. Join existing project"
    echo "  3. Create new project (v2 multi-team)"
    echo ""
    read -r -p "  Choice [1]: " mode_choice

    case "${mode_choice:-1}" in
        1|new|create)
            collect_info
            confirm_setup
            execute_setup
            print_done
            ;;
        2|join)
            join_project
            ;;
        3|v2)
            collect_info_v2
            confirm_setup_v2
            execute_setup_v2
            print_done_v2
            ;;
        *)
            collect_info
            confirm_setup
            execute_setup
            print_done
            ;;
    esac
}

main "$@"
