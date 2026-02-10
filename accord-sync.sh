#!/usr/bin/env bash
# Accord Sync — Hub-and-Spoke sync for multi-repo setups
#
# Usage:
#   accord-sync.sh init   [options]   # Clone hub repo into .accord/hub/
#   accord-sync.sh pull   [options]   # Pull from hub, copy incoming requests to local inbox
#   accord-sync.sh push   [options]   # Push local contracts/requests to hub
#
# Options:
#   --service-name <name>     Override auto-detected service name
#   --target-dir <path>       Project directory (default: current directory)
#   --help                    Show this help message
#
# Reads .accord/config.yaml to find:
#   - hub: <git-url>          The hub repository URL
#   - services: [{name: ...}] Service names (first one = own service in multi-repo)

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────

SUBCOMMAND=""
SERVICE_NAME=""
TARGET_DIR="."

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo "[accord-sync] $*"; }
warn() { echo "[accord-sync] WARNING: $*" >&2; }
err() { echo "[accord-sync] ERROR: $*" >&2; exit 1; }

usage() {
    cat <<'HELP'
Usage: accord-sync.sh <command> [options]

Commands:
  init    Clone hub repository into .accord/hub/
  pull    Pull latest from hub; copy incoming requests to local inbox
  push    Push local contracts and outgoing requests to hub

Options:
  --service-name <name>     Override auto-detected service name
  --target-dir <path>       Project directory (default: current directory)
  --help                    Show this help message

The script reads .accord/config.yaml for hub URL and service name.
HELP
}

# Read a simple YAML value: yaml_val "key" "file"
# Works for top-level scalar keys like "hub: value"
yaml_val() {
    local key="$1" file="$2"
    sed -n "s/^${key}:[[:space:]]*//p" "$file" | head -1 | tr -d '"' | tr -d "'" | xargs
}

# Read the first service name from config (multi-repo = one service per repo)
yaml_first_service() {
    local file="$1"
    sed -n '/^services:/,/^[^ ]/{ s/^[[:space:]]*- name:[[:space:]]*//p; }' "$file" | head -1 | xargs
}

# List all service names from config
yaml_all_services() {
    local file="$1"
    sed -n '/^services:/,/^[^ ]/{ s/^[[:space:]]*- name:[[:space:]]*//p; }' "$file" | xargs
}

# ── Argument Parsing ─────────────────────────────────────────────────────────

parse_args() {
    [[ $# -eq 0 ]] && { usage; exit 1; }

    SUBCOMMAND="$1"; shift

    case "$SUBCOMMAND" in
        init|pull|push) ;;
        --help|-h) usage; exit 0 ;;
        *) err "Unknown command: $SUBCOMMAND. Use init, pull, or push." ;;
    esac

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --service-name) SERVICE_NAME="$2"; shift 2 ;;
            --target-dir)   TARGET_DIR="$2"; shift 2 ;;
            --help)         usage; exit 0 ;;
            *)              err "Unknown option: $1" ;;
        esac
    done
}

# ── Read Config ──────────────────────────────────────────────────────────────

read_config() {
    local config="$TARGET_DIR/.accord/config.yaml"

    if [[ ! -f "$config" ]]; then
        err "Config not found: $config — run 'accord init' first"
    fi

    local repo_model
    repo_model="$(yaml_val "repo_model" "$config")"
    if [[ "$repo_model" != "multi-repo" ]]; then
        err "repo_model is '$repo_model', not 'multi-repo'. Sync is only for multi-repo setups."
    fi

    HUB_URL="$(yaml_val "hub" "$config")"
    if [[ -z "$HUB_URL" ]]; then
        err "No 'hub:' URL found in $config"
    fi

    if [[ -z "$SERVICE_NAME" ]]; then
        SERVICE_NAME="$(yaml_first_service "$config")"
    fi
    if [[ -z "$SERVICE_NAME" ]]; then
        err "Cannot determine service name from config. Use --service-name."
    fi

    ALL_SERVICES="$(yaml_all_services "$config")"

    HUB_DIR="$TARGET_DIR/.accord/hub"
}

# ── init: Clone hub ─────────────────────────────────────────────────────────

do_init() {
    if [[ -d "$HUB_DIR/.git" ]]; then
        log "Hub already cloned at $HUB_DIR"
        log "Pulling latest..."
        (cd "$HUB_DIR" && git pull --quiet)
        return
    fi

    log "Cloning hub: $HUB_URL → $HUB_DIR"
    mkdir -p "$HUB_DIR"
    git clone "$HUB_URL" "$HUB_DIR"

    # If hub is empty (fresh repo), create initial structure
    if [[ ! -d "$HUB_DIR/contracts" ]]; then
        log "Hub is empty — initializing structure"
        mkdir -p "$HUB_DIR/contracts"
        mkdir -p "$HUB_DIR/contracts/internal"
        mkdir -p "$HUB_DIR/comms/archive"

        # Create inboxes for all known services
        for svc in $ALL_SERVICES; do
            mkdir -p "$HUB_DIR/comms/inbox/$svc"
            touch "$HUB_DIR/comms/inbox/$svc/.gitkeep"
        done

        (cd "$HUB_DIR" && git add -A && git commit -m "accord: init hub structure" && git push) || true
        log "Hub initialized with hub structure"
    fi

    log "Hub cloned successfully"
}

# ── pull: Fetch from hub ────────────────────────────────────────────────────

do_pull() {
    if [[ ! -d "$HUB_DIR/.git" ]]; then
        err "Hub not found at $HUB_DIR — run 'accord-sync.sh init' first"
    fi

    log "Pulling latest from hub..."
    (cd "$HUB_DIR" && git pull --quiet)

    # Copy incoming requests from hub inbox to local inbox
    local hub_inbox="$HUB_DIR/comms/inbox/$SERVICE_NAME"
    local local_inbox="$TARGET_DIR/.accord/comms/inbox/$SERVICE_NAME"
    local new_count=0

    if [[ -d "$hub_inbox" ]]; then
        mkdir -p "$local_inbox"
        for req_file in "$hub_inbox"/req-*.md; do
            [[ ! -f "$req_file" ]] && continue
            local fname
            fname="$(basename "$req_file")"
            if [[ ! -f "$local_inbox/$fname" ]]; then
                cp "$req_file" "$local_inbox/$fname"
                new_count=$((new_count + 1))
                log "  New request: $fname"
            fi
        done
    fi

    # Copy other services' contracts from hub so we can see them locally
    local hub_contracts="$HUB_DIR/contracts"
    local local_contracts="$TARGET_DIR/.accord/contracts"

    if [[ -d "$hub_contracts" ]]; then
        for contract_file in "$hub_contracts"/*.yaml; do
            [[ ! -f "$contract_file" ]] && continue
            local fname
            fname="$(basename "$contract_file")"
            local svc_name="${fname%.yaml}"
            # Don't overwrite our own contract — we are the source of truth
            if [[ "$svc_name" != "$SERVICE_NAME" ]]; then
                cp "$contract_file" "$local_contracts/$fname"
            fi
        done
    fi

    # Copy internal contracts from hub (other services' internal contracts)
    local hub_internal="$HUB_DIR/contracts/internal"
    local local_internal="$TARGET_DIR/.accord/contracts/internal"

    if [[ -d "$hub_internal" ]]; then
        for svc_dir in "$hub_internal"/*/; do
            [[ ! -d "$svc_dir" ]] && continue
            local svc_name
            svc_name="$(basename "$svc_dir")"
            [[ "$svc_name" == "$SERVICE_NAME" ]] && continue
            mkdir -p "$local_internal/$svc_name"
            for f in "$svc_dir"*.md; do
                [[ -f "$f" ]] && cp "$f" "$local_internal/$svc_name/"
            done
        done
    fi

    if [[ $new_count -gt 0 ]]; then
        log "Pulled $new_count new request(s) from hub"
    else
        log "No new requests"
    fi
    log "Pull complete"
}

# ── push: Send to hub ──────────────────────────────────────────────────────

do_push() {
    if [[ ! -d "$HUB_DIR/.git" ]]; then
        err "Hub not found at $HUB_DIR — run 'accord-sync.sh init' first"
    fi

    log "Pulling hub before push..."
    (cd "$HUB_DIR" && git pull --quiet)

    local changes=0

    # 1. Copy own contract → hub
    local own_contract="$TARGET_DIR/.accord/contracts/${SERVICE_NAME}.yaml"
    if [[ -f "$own_contract" ]]; then
        mkdir -p "$HUB_DIR/contracts"
        cp "$own_contract" "$HUB_DIR/contracts/${SERVICE_NAME}.yaml"
        changes=$((changes + 1))
        log "  Synced contract: ${SERVICE_NAME}.yaml"
    fi

    # 2. Copy own internal contracts → hub (under service namespace)
    local own_internal="$TARGET_DIR/.accord/contracts/internal"
    if [[ -d "$own_internal" ]]; then
        # Only copy files directly in internal/ (our modules), not subdirs (other services)
        local has_internal=false
        for f in "$own_internal"/*.md; do
            [[ ! -f "$f" ]] && continue
            has_internal=true
            break
        done
        if [[ "$has_internal" == true ]]; then
            mkdir -p "$HUB_DIR/contracts/internal/$SERVICE_NAME"
            for f in "$own_internal"/*.md; do
                [[ ! -f "$f" ]] && continue
                cp "$f" "$HUB_DIR/contracts/internal/$SERVICE_NAME/"
                changes=$((changes + 1))
            done
            log "  Synced internal contracts to hub"
        fi
    fi

    # 3. Copy outgoing requests to other services' hub inboxes
    local local_comms="$TARGET_DIR/.accord/comms/inbox"
    if [[ -d "$local_comms" ]]; then
        for inbox_dir in "$local_comms"/*/; do
            [[ ! -d "$inbox_dir" ]] && continue
            local target_svc
            target_svc="$(basename "$inbox_dir")"
            # Skip our own inbox — those are incoming, not outgoing
            [[ "$target_svc" == "$SERVICE_NAME" ]] && continue
            for req_file in "$inbox_dir"req-*.md; do
                [[ ! -f "$req_file" ]] && continue
                local fname
                fname="$(basename "$req_file")"
                mkdir -p "$HUB_DIR/comms/inbox/$target_svc"
                cp "$req_file" "$HUB_DIR/comms/inbox/$target_svc/$fname"
                changes=$((changes + 1))
                log "  Pushed request $fname → $target_svc inbox"
            done
        done
    fi

    # 4. Copy archived requests → hub archive
    local local_archive="$TARGET_DIR/.accord/comms/archive"
    if [[ -d "$local_archive" ]]; then
        mkdir -p "$HUB_DIR/comms/archive"
        for f in "$local_archive"/req-*.md; do
            [[ ! -f "$f" ]] && continue
            local fname
            fname="$(basename "$f")"
            cp "$f" "$HUB_DIR/comms/archive/$fname"
            changes=$((changes + 1))
        done
    fi

    # 5. Commit and push hub (only if there are actual git changes)
    (cd "$HUB_DIR" && git add -A)
    if (cd "$HUB_DIR" && git diff --cached --quiet); then
        log "No changes to push"
    else
        (cd "$HUB_DIR" && git commit -m "accord-sync($SERVICE_NAME): push" && git push)
        log "Pushed changes to hub"
    fi

    log "Push complete"
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    parse_args "$@"

    TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

    read_config

    case "$SUBCOMMAND" in
        init) do_init ;;
        pull) do_pull ;;
        push) do_push ;;
    esac
}

main "$@"
