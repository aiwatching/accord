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
        fi
        read -r -p "  $svc directory [$default_dir]: " dir_input
        SVC_DIRS+=("${dir_input:-$default_dir}")
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
            repo_info=" (repo: ${SVC_REPOS[$i]})"
        fi
        echo -e "    ${GREEN}${SVC_NAMES[$i]}${NC} → ${SVC_DIRS[$i]}${repo_info}"
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
        local dir="${SVC_DIRS[$i]}"
        local repo="${SVC_REPOS[$i]:-}"

        # Resolve relative paths
        if [[ "$dir" != /* ]]; then dir="$project_dir/$dir"; fi

        # Clone if repo URL is available and directory doesn't exist
        if [[ -n "$repo" && ! -d "$dir" ]]; then
            log "Cloning $svc → $dir"
            git clone "$repo" "$dir" || { warn "Failed to clone $svc"; continue; }
        elif [[ ! -d "$dir" ]]; then
            warn "Directory not found: ${SVC_DIRS[$i]} (skipping $svc)"
            continue
        fi

        local svc_dir
        svc_dir="$(cd "$dir" && pwd)"

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
            --service-name "$svc"
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
    for i in "${!SVC_NAMES[@]}"; do
        echo "       cd ${SVC_DIRS[$i]}"
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
    echo "    3. (Alternative) Start the Hub Service (API + Web UI + scheduler):"
    echo ""
    echo "       accord-hub --hub-dir $HUB_DIR --port 3000"
    echo -e "       ${DIM}# Opens on http://localhost:3000 — dashboard, API, live streaming${NC}"
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
    echo "  1. Create new project"
    echo "  2. Join existing project"
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
        *)
            collect_info
            confirm_setup
            execute_setup
            print_done
            ;;
    esac
}

main "$@"
