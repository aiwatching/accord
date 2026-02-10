#!/usr/bin/env bash
# Accord Log Viewer
#
# Copies the debug viewer to .accord/log/, generates a manifest.json
# listing all .jsonl files, and starts a local HTTP server.
#
# Usage:
#   ~/.accord/accord-log.sh                    # Serve logs in current project
#   ~/.accord/accord-log.sh --port 9000        # Custom port
#   ~/.accord/accord-log.sh --no-open          # Don't open browser
#   ~/.accord/accord-log.sh --target-dir /path # Different project

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────

TARGET_DIR="."
PORT=8420
OPEN_BROWSER=true

GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo -e "[accord-log] $*"; }
err() { echo -e "[accord-log] ERROR: $*" >&2; exit 1; }

# ── Argument Parsing ─────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target-dir) TARGET_DIR="$2"; shift 2 ;;
        --port)       PORT="$2"; shift 2 ;;
        --no-open)    OPEN_BROWSER=false; shift ;;
        --help)
            echo "Usage: accord-log.sh [OPTIONS]"
            echo ""
            echo "Serve the Accord debug log viewer with auto-discovery of .jsonl files."
            echo ""
            echo "Options:"
            echo "  --target-dir <path>   Project directory (default: current directory)"
            echo "  --port <port>         HTTP server port (default: 8420)"
            echo "  --no-open             Don't open browser automatically"
            echo "  --help                Show this help"
            echo ""
            echo "The viewer will be available at http://localhost:<port>"
            exit 0
            ;;
        *) err "Unknown option: $1. Use --help for usage." ;;
    esac
done

TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"
LOG_DIR="$TARGET_DIR/.accord/log"

# ── Validate ─────────────────────────────────────────────────────────────────

if [[ ! -d "$TARGET_DIR/.accord" ]]; then
    err "No .accord/ directory found in $TARGET_DIR — is this an Accord project?"
fi

if [[ ! -d "$LOG_DIR" ]]; then
    mkdir -p "$LOG_DIR"
    log "Created .accord/log/"
fi

# ── Copy viewer ──────────────────────────────────────────────────────────────

VIEWER_SRC="$ACCORD_DIR/protocol/debug/viewer.html"

if [[ ! -f "$VIEWER_SRC" ]]; then
    err "Viewer not found at $VIEWER_SRC"
fi

cp "$VIEWER_SRC" "$LOG_DIR/index.html"
log "Copied viewer to .accord/log/index.html"

# ── Generate manifest ────────────────────────────────────────────────────────

generate_manifest() {
    local manifest="$LOG_DIR/manifest.json"
    local files=""
    local count=0

    for f in "$LOG_DIR"/*.jsonl; do
        [[ -f "$f" ]] || continue
        local name
        name="$(basename "$f")"
        if [[ -n "$files" ]]; then
            files="$files,\"$name\""
        else
            files="\"$name\""
        fi
        count=$((count + 1))
    done

    local now
    now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

    echo "{\"files\":[$files],\"generated\":\"$now\"}" > "$manifest"
    echo "$count"
}

FILE_COUNT="$(generate_manifest)"

# ── Check for log files ──────────────────────────────────────────────────────

if [[ "$FILE_COUNT" -eq 0 ]]; then
    log "No .jsonl log files found in .accord/log/"
    log "Enable debug logging: set ${BOLD}debug: true${NC} in .accord/config.yaml"
    log ""
    log "Starting viewer anyway (you can drag-drop files into it)..."
fi

# ── Start server ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}=== Accord Log Viewer ===${NC}"
echo ""
echo -e "  Log files:  ${GREEN}$FILE_COUNT${NC}"
echo -e "  Serving:    ${GREEN}http://localhost:$PORT${NC}"
echo -e "  Directory:  ${DIM}$LOG_DIR${NC}"
echo ""
echo -e "  ${DIM}Press Ctrl+C to stop${NC}"
echo ""

# Open browser
if [[ "$OPEN_BROWSER" == true ]]; then
    if command -v open >/dev/null 2>&1; then
        open "http://localhost:$PORT" 2>/dev/null &
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "http://localhost:$PORT" 2>/dev/null &
    fi
fi

# Regenerate manifest periodically in background
(
    while true; do
        sleep 5
        generate_manifest > /dev/null 2>&1
    done
) &
MANIFEST_PID=$!
trap "kill $MANIFEST_PID 2>/dev/null; exit 0" INT TERM

# Start HTTP server
cd "$LOG_DIR"
if command -v python3 >/dev/null 2>&1; then
    python3 -m http.server "$PORT" 2>/dev/null
elif command -v python >/dev/null 2>&1; then
    python -m http.server "$PORT" 2>/dev/null
else
    err "Python not found — needed for HTTP server"
fi
