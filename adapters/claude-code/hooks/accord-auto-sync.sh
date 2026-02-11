#!/usr/bin/env bash
# Accord Auto-Sync Hook for Claude Code
#
# Installed as a Claude Code hook (SessionStart / Stop).
# Reads .accord/config.yaml at runtime to decide whether to sync.
#
# - SessionStart: always sync (pull from hub)
# - Stop: time-gated sync (pull every 5 minutes)
#
# Safe to install for any project — exits silently if not multi-repo.

set -euo pipefail

# Claude Code provides the project directory
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
cd "$PROJECT_DIR"

# ── Read hook event from stdin ───────────────────────────────────────────────
# Claude Code pipes a JSON object with event info to stdin.
# We need the event name to decide behavior.
HOOK_INPUT=""
if ! tty -s 2>/dev/null; then
    HOOK_INPUT="$(cat)"
fi

# ── Check repo model ────────────────────────────────────────────────────────
# Only run for multi-repo projects that have a hub to sync from.
CONFIG_FILE=".accord/config.yaml"
if [[ ! -f "$CONFIG_FILE" ]]; then
    exit 0
fi

REPO_MODEL="$(sed -n 's/^repo_model:[[:space:]]*//p' "$CONFIG_FILE" | xargs)"
if [[ "$REPO_MODEL" != "multi-repo" ]]; then
    exit 0
fi

# Verify sync script exists
SYNC_SCRIPT=".accord/accord-sync.sh"
if [[ ! -f "$SYNC_SCRIPT" ]]; then
    exit 0
fi

# ── Determine event type ────────────────────────────────────────────────────
# Claude Code sends hook_event_name in the JSON input.
EVENT=""
if [[ -n "$HOOK_INPUT" ]]; then
    # Use python3 for reliable JSON parsing (available on macOS/Linux)
    EVENT="$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name',''))" 2>/dev/null || true)"
fi

# ── Time-gating for Stop events ─────────────────────────────────────────────
TIMESTAMP_FILE=".accord/.last-sync-pull"
INTERVAL=300  # 5 minutes in seconds

if [[ "$EVENT" == "Stop" ]]; then
    if [[ -f "$TIMESTAMP_FILE" ]]; then
        LAST_SYNC="$(cat "$TIMESTAMP_FILE")"
        NOW="$(date +%s)"
        ELAPSED=$((NOW - LAST_SYNC))
        if [[ "$ELAPSED" -lt "$INTERVAL" ]]; then
            exit 0
        fi
    fi
fi

# ── Run sync ─────────────────────────────────────────────────────────────────
OUTPUT="$(bash "$SYNC_SCRIPT" pull --target-dir . 2>&1)" || true

# Update timestamp
date +%s > "$TIMESTAMP_FILE"

# Output results to stdout — Claude Code injects this into the agent's context
if [[ -n "$OUTPUT" ]]; then
    echo "[accord-auto-sync] Hub sync completed:"
    echo "$OUTPUT"
else
    echo "[accord-auto-sync] Hub sync completed (no changes)."
fi
