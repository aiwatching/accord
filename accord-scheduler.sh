#!/usr/bin/env bash
# Accord Scheduler — automated inbox processing for services and orchestrator
#
# Usage:
#   accord-scheduler.sh [--mode auto|manual] [--interval 300] [--target-dir .]
#
# Manual mode (default): pull → check inbox → print status → exit
# Auto mode: loop (pull → check inbox → report → sleep interval)
#
# Note: This scheduler does NOT invoke the agent. It reports what needs
# processing. The user or CI triggers the agent session. This matches
# the v2 "on-demand" model where the orchestrator starts, acts, then exits.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────

MODE="manual"
INTERVAL=300
TARGET_DIR="."

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo "[accord-scheduler] $(date '+%H:%M:%S') $*"; }
warn() { echo "[accord-scheduler] WARNING: $*" >&2; }
err() { echo "[accord-scheduler] ERROR: $*" >&2; exit 1; }

usage() {
    cat <<'HELP'
Usage: accord-scheduler.sh [options]

Automated inbox processing for Accord services and orchestrator.

Options:
  --mode <mode>         auto | manual (default: manual)
  --interval <seconds>  Polling interval for auto mode (default: 300)
  --target-dir <path>   Project directory (default: current directory)
  --help                Show this help message

Manual mode: sync → check inbox → report → exit
Auto mode:   loop (sync → check inbox → report → sleep)

The scheduler reports what needs processing. It does NOT invoke the agent.
HELP
}

# ── Argument Parsing ─────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode)       MODE="$2"; shift 2 ;;
        --interval)   INTERVAL="$2"; shift 2 ;;
        --target-dir) TARGET_DIR="$2"; shift 2 ;;
        --help)       usage; exit 0 ;;
        *)            err "Unknown option: $1" ;;
    esac
done

case "$MODE" in
    auto|manual) ;;
    *) err "Invalid mode: $MODE (must be auto or manual)" ;;
esac

TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

# ── Detect Role ──────────────────────────────────────────────────────────────

detect_role() {
    # Orchestrator has flat config.yaml with role: orchestrator
    if [[ -f "$TARGET_DIR/config.yaml" ]]; then
        if grep -q "role: orchestrator" "$TARGET_DIR/config.yaml" 2>/dev/null; then
            echo "orchestrator"
            return
        fi
    fi
    # Service has .accord/config.yaml
    if [[ -f "$TARGET_DIR/.accord/config.yaml" ]]; then
        echo "service"
        return
    fi
    echo "unknown"
}

# ── Sync ─────────────────────────────────────────────────────────────────────

do_sync() {
    local role="$1"

    if [[ "$role" == "orchestrator" ]]; then
        # Orchestrator: just git pull on the hub repo
        if git -C "$TARGET_DIR" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
            git -C "$TARGET_DIR" pull --quiet 2>/dev/null || log "Git pull failed (offline?)"
        fi
    else
        # Service: use accord-sync.sh if available and multi-repo
        local sync_script="$TARGET_DIR/.accord/accord-sync.sh"
        if [[ -f "$sync_script" ]]; then
            bash "$sync_script" pull --target-dir "$TARGET_DIR" 2>/dev/null || log "Sync pull failed"
        elif git -C "$TARGET_DIR" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
            git -C "$TARGET_DIR" pull --quiet 2>/dev/null || log "Git pull failed (offline?)"
        fi
    fi
}

# ── Check Inbox ──────────────────────────────────────────────────────────────

check_inbox() {
    local role="$1"
    local inbox_base=""
    local pending=0
    local approved=0

    if [[ "$role" == "orchestrator" ]]; then
        inbox_base="$TARGET_DIR/comms/inbox"
    else
        inbox_base="$TARGET_DIR/.accord/comms/inbox"
    fi

    if [[ ! -d "$inbox_base" ]]; then
        log "No inbox directory found"
        return
    fi

    for inbox_dir in "$inbox_base"/*/; do
        [[ ! -d "$inbox_dir" ]] && continue
        local svc_name
        svc_name="$(basename "$inbox_dir")"
        for req_file in "$inbox_dir"req-*.md; do
            [[ ! -f "$req_file" ]] && continue
            local status
            status="$(grep "^status:" "$req_file" 2>/dev/null | head -1 | sed 's/^status:[[:space:]]*//')"
            case "$status" in
                pending) pending=$((pending + 1)) ;;
                approved) approved=$((approved + 1)) ;;
            esac
        done
    done

    # Orchestrator-specific: also check for pending directives
    local directives_pending=0
    if [[ "$role" == "orchestrator" && -d "$TARGET_DIR/directives" ]]; then
        for dir_file in "$TARGET_DIR/directives"/*.md; do
            [[ ! -f "$dir_file" ]] && continue
            local status
            status="$(grep "^status:" "$dir_file" 2>/dev/null | head -1 | sed 's/^status:[[:space:]]*//')"
            [[ "$status" == "pending" ]] && directives_pending=$((directives_pending + 1))
        done
    fi

    log "Status: $pending pending request(s), $approved approved request(s)"
    if [[ "$role" == "orchestrator" && $directives_pending -gt 0 ]]; then
        log "  $directives_pending pending directive(s) awaiting decomposition"
    fi

    # Return combined count for auto-mode detection
    echo $((pending + approved + directives_pending))
}

# ── Run Once ─────────────────────────────────────────────────────────────────

run_once() {
    local role
    role="$(detect_role)"

    if [[ "$role" == "unknown" ]]; then
        err "Cannot detect role. No config.yaml or .accord/config.yaml found in $TARGET_DIR"
    fi

    log "Role: $role"
    do_sync "$role"
    check_inbox "$role" > /dev/null
    # Re-run to display output (check_inbox echoes the count)
    check_inbox "$role" | tail -1 > /dev/null  # suppress count echo
}

# ── Main Loop ────────────────────────────────────────────────────────────────

main() {
    local role
    role="$(detect_role)"

    if [[ "$role" == "unknown" ]]; then
        err "Cannot detect role. No config.yaml or .accord/config.yaml found in $TARGET_DIR"
    fi

    if [[ "$MODE" == "manual" ]]; then
        log "Manual mode — single check"
        log "Role: $role"
        do_sync "$role"
        check_inbox "$role" > /dev/null
        log "Done"
    else
        log "Auto mode — polling every ${INTERVAL}s (role: $role, pid $$)"
        while true; do
            do_sync "$role"
            check_inbox "$role" > /dev/null
            sleep "$INTERVAL"
        done
    fi
}

main
