#!/usr/bin/env bash
# Accord Agent — thin wrapper
#
# Delegates to the TypeScript agent (agent/dist/index.js) if Node.js >=20
# and the built agent exist. Falls back to the legacy bash agent otherwise.
#
# For the `start` command, forks the process to background automatically.
#
# Usage: accord-agent.sh <command> [options]
# See accord-agent.sh --help for details.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_JS="$SCRIPT_DIR/agent/dist/index.js"
LEGACY="$SCRIPT_DIR/accord-agent-legacy.sh"

# ── Check Node.js ───────────────────────────────────────────────────────────

use_ts_agent() {
    # Check node exists
    if ! command -v node > /dev/null 2>&1; then
        return 1
    fi

    # Check node version >= 20
    local ver
    ver="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
    if [[ -z "$ver" || "$ver" -lt 20 ]]; then
        return 1
    fi

    # Check built agent exists
    if [[ ! -f "$AGENT_JS" ]]; then
        return 1
    fi

    return 0
}

# ── Parse first positional arg (command) ────────────────────────────────────

get_command() {
    for arg in "$@"; do
        if [[ ! "$arg" == --* ]]; then
            echo "$arg"
            return
        fi
    done
    echo ""
}

# ── Create a node symlink for process name visibility ───────────────────────

get_node_exec() {
    # Create a symlink to node named "accord-agent" so ps shows the right name
    local link_dir="$SCRIPT_DIR/agent/.bin"
    local link_path="$link_dir/accord-agent"
    local node_path
    node_path="$(command -v node)"

    if [[ ! -L "$link_path" ]] || [[ "$(readlink "$link_path")" != "$node_path" ]]; then
        mkdir -p "$link_dir"
        ln -sf "$node_path" "$link_path"
    fi

    echo "$link_path"
}

# ── Dispatch ────────────────────────────────────────────────────────────────

CMD="$(get_command "$@")"

if use_ts_agent; then
    NODE_EXEC="$(get_node_exec)"

    if [[ "$CMD" == "start" ]]; then
        # Check if already running before backgrounding
        # Extract --target-dir from args
        TARGET_DIR="."
        for ((i=1; i<=$#; i++)); do
            arg="${!i}"
            if [[ "$arg" == "--target-dir" ]]; then
                next=$((i+1))
                TARGET_DIR="${!next}"
            fi
        done
        PID_FILE="$TARGET_DIR/.accord/.agent.pid"
        if [[ -f "$PID_FILE" ]]; then
            existing_pid=$(cat "$PID_FILE" 2>/dev/null)
            if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
                echo "Already running (PID $existing_pid)"
                exit 0
            fi
        fi

        # Fork to background: `start` is a daemon command
        nohup "$NODE_EXEC" "$AGENT_JS" "$@" > /dev/null 2>&1 &
        disown
        # Wait briefly for PID file to be written by the TS process
        sleep 0.5
    else
        exec "$NODE_EXEC" "$AGENT_JS" "$@"
    fi
else
    if [[ -f "$LEGACY" ]]; then
        echo "[accord-agent] TypeScript agent not available, using legacy bash agent" >&2
        exec bash "$LEGACY" "$@"
    else
        echo "[accord-agent] ERROR: No agent available. Run 'cd agent && npm install && npm run build'" >&2
        exit 1
    fi
fi
