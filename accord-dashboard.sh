#!/usr/bin/env bash
set -euo pipefail

# ── Accord Dashboard Launcher ────────────────────────────────────────────────
# Serves the Accord dashboard as a local web page.
#
# Usage:
#   accord-dashboard.sh [--port PORT] [--history-dir DIR]
#
# Options:
#   --port PORT         Port to serve on (default: 8080)
#   --history-dir DIR   Path to comms/history/ directory (informational only)
#
# The dashboard is a single-file HTML app that loads JSONL files via file input.
# This script simply starts a local HTTP server serving the dashboard.
# ─────────────────────────────────────────────────────────────────────────────

PORT=8080
HISTORY_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --history-dir) HISTORY_DIR="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: accord-dashboard.sh [--port PORT] [--history-dir DIR]"
      echo ""
      echo "Starts a local web server serving the Accord dashboard."
      echo ""
      echo "Options:"
      echo "  --port PORT         Port to serve on (default: 8080)"
      echo "  --history-dir DIR   Print the history directory path for convenience"
      echo ""
      echo "Once started, open http://localhost:PORT in your browser"
      echo "and load .jsonl files from your comms/history/ directory."
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Find dashboard HTML
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD_DIR=""

# Check relative to script
if [[ -f "$SCRIPT_DIR/protocol/dashboard/index.html" ]]; then
  DASHBOARD_DIR="$SCRIPT_DIR/protocol/dashboard"
elif [[ -f "$HOME/.accord/protocol/dashboard/index.html" ]]; then
  DASHBOARD_DIR="$HOME/.accord/protocol/dashboard"
else
  echo "ERROR: Cannot find protocol/dashboard/index.html"
  echo "Looked in:"
  echo "  $SCRIPT_DIR/protocol/dashboard/"
  echo "  $HOME/.accord/protocol/dashboard/"
  exit 1
fi

echo "Accord Dashboard"
echo "================"
echo ""
echo "  URL:       http://localhost:$PORT"
echo "  Dashboard: $DASHBOARD_DIR/index.html"

if [[ -n "$HISTORY_DIR" ]]; then
  echo "  History:   $HISTORY_DIR"
fi

echo ""
echo "Load .jsonl files from your comms/history/ directory in the browser."
echo "Press Ctrl+C to stop."
echo ""

# Serve using Python 3
if command -v python3 &>/dev/null; then
  cd "$DASHBOARD_DIR"
  python3 -m http.server "$PORT"
elif command -v python &>/dev/null; then
  cd "$DASHBOARD_DIR"
  python -m http.server "$PORT"
else
  echo "ERROR: Python 3 is required to serve the dashboard."
  echo "Install Python 3 or open $DASHBOARD_DIR/index.html directly in a browser."
  exit 1
fi
