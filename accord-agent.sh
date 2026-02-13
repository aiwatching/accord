#!/usr/bin/env bash
# Accord Agent — thin wrapper
#
# Delegates to the TypeScript agent (agent/dist/index.js) if Node.js >=20
# and the built agent exist. Falls back to the legacy bash agent otherwise.
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

# ── Dispatch ────────────────────────────────────────────────────────────────

if use_ts_agent; then
    exec node "$AGENT_JS" "$@"
else
    if [[ -f "$LEGACY" ]]; then
        echo "[accord-agent] TypeScript agent not available, using legacy bash agent" >&2
        exec bash "$LEGACY" "$@"
    else
        echo "[accord-agent] ERROR: No agent available. Run 'cd agent && npm install && npm run build'" >&2
        exit 1
    fi
fi
