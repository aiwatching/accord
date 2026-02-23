#!/usr/bin/env bash
# accord-hub — update, build & start the Accord Hub Service
#
# Usage:
#   accord-hub --hub-dir /path/to/hub [--port 3000] [options]
#   accord-hub update          Pull latest accord code + rebuild
#   accord-hub --help

set -euo pipefail

# Resolve symlinks to find the real script directory
SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
    DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/agent"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

log() { echo -e "${GREEN}[accord-hub]${NC} $*"; }
die() { echo -e "\033[0;31m[accord-hub] ERROR:${NC} $*" >&2; exit 1; }

# ── Subcommand: update ──────────────────────────────────────────────────

do_update() {
    log "Updating accord..."

    # Pull latest code
    if [[ -d "$SCRIPT_DIR/.git" ]]; then
        log "Pulling latest code..."
        (cd "$SCRIPT_DIR" && git pull --rebase)
    else
        die "Not a git repo — cannot update. Re-install with install.sh"
    fi

    # Reinstall deps if package.json changed
    log "Checking dependencies..."
    (cd "$AGENT_DIR" && npm install --quiet)

    # Force rebuild
    log "Rebuilding server + UI..."
    (cd "$AGENT_DIR" && npm run build)

    log "Update complete — $(cd "$SCRIPT_DIR" && git log --oneline -1)"
    exit 0
}

# ── Parse args ──────────────────────────────────────────────────────────

REBUILD=false
ARGS=()

# Check for subcommand first
if [[ "${1:-}" == "update" ]]; then
    do_update
fi

for arg in "$@"; do
    if [[ "$arg" == "--rebuild" ]]; then
        REBUILD=true
    elif [[ "$arg" == "--help" || "$arg" == "-h" ]]; then
        echo "Usage: accord-hub [command] [options]"
        echo ""
        echo "Commands:"
        echo "  update                Pull latest accord code, install deps, rebuild"
        echo ""
        echo "Options:"
        echo "  --hub-dir <path>      Hub/project directory (required)"
        echo "  --port <number>       HTTP server port (default: 3000, or from config)"
        echo "  --workers <N>         Number of concurrent workers (default: 4)"
        echo "  --interval <seconds>  Scheduler polling interval (default: 30)"
        echo "  --timeout <seconds>   Per-request timeout (default: 600)"
        echo "  --agent-cmd <cmd>     Shell command for agent (instead of Claude SDK)"
        echo "  --rebuild             Force rebuild before starting"
        echo "  --help                Show this help message"
        echo ""
        echo "Examples:"
        echo "  accord-hub --hub-dir ./my-hub --port 3000"
        echo "  accord-hub update"
        echo "  accord-hub --hub-dir ./my-hub --rebuild"
        exit 0
    else
        ARGS+=("$arg")
    fi
done

# ── Checks ──────────────────────────────────────────────────────────────

[[ -d "$AGENT_DIR" ]] || die "agent/ directory not found at $AGENT_DIR"

if ! command -v node >/dev/null 2>&1; then
    die "Node.js is required. Install Node.js >= 20."
fi

NODE_VER="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [[ "$NODE_VER" -lt 20 ]]; then
    die "Node.js >= 20 required (found v$(node -v))"
fi

# ── Install deps if needed ──────────────────────────────────────────────

if [[ ! -d "$AGENT_DIR/node_modules" ]]; then
    log "Installing dependencies..."
    (cd "$AGENT_DIR" && npm install --quiet)
fi

# ── Build if needed ─────────────────────────────────────────────────────

SERVER_DIST="$AGENT_DIR/dist/server/index.js"
UI_DIST="$AGENT_DIR/ui/dist/index.html"

needs_build() {
    [[ "$REBUILD" == true ]] && return 0
    [[ ! -f "$SERVER_DIST" ]] && return 0
    [[ ! -f "$UI_DIST" ]] && return 0

    # Check if any source file is newer than dist
    local newest_server newest_ui
    newest_server=$(find "$AGENT_DIR/server" -name '*.ts' -newer "$SERVER_DIST" 2>/dev/null | head -1)
    newest_ui=$(find "$AGENT_DIR/ui/src" -name '*.tsx' -name '*.ts' -newer "$UI_DIST" 2>/dev/null | head -1)

    [[ -n "$newest_server" || -n "$newest_ui" ]] && return 0
    return 1
}

if needs_build; then
    log "Building server + UI..."
    (cd "$AGENT_DIR" && npm run build --silent 2>&1)
    log "Build complete"
else
    log "Up to date — skipping build"
fi

# ── Start ───────────────────────────────────────────────────────────────

log "Starting Hub Service..."
exec node "$SERVER_DIST" "${ARGS[@]}"
