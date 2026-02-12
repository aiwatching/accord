#!/usr/bin/env bash
# Installs the Claude Code orchestrator adapter into a hub project.
#
# Usage:
#   install.sh --project-dir <path> --service-list <csv> [options]
#
# This script:
# 1. Injects orchestrator Accord rules into the project's CLAUDE.md (idempotent, uses markers)
# 2. Copies orchestrator slash commands to .claude/commands/

set -euo pipefail

ADAPTER_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────

PROJECT_DIR=""
PROJECT_NAME=""
SERVICE_LIST=""

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo "[accord/claude-code/orchestrator] $*"; }
warn() { echo "[accord/claude-code/orchestrator] WARNING: $*" >&2; }
err() { echo "[accord/claude-code/orchestrator] ERROR: $*" >&2; exit 1; }

sed_inplace() {
    local expression="$1"
    local file="$2"
    local tmp="${file}.accord_tmp"
    sed "$expression" "$file" > "$tmp" && mv "$tmp" "$file"
}

replace_vars() {
    local file="$1"
    shift
    while [[ $# -ge 2 ]]; do
        local var="$1"
        local val="$2"
        sed_inplace "s|{{${var}}}|${val}|g" "$file"
        shift 2
    done
}

# ── Argument Parsing ─────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-dir)    PROJECT_DIR="$2"; shift 2 ;;
        --project-name)   PROJECT_NAME="$2"; shift 2 ;;
        --service-list)   SERVICE_LIST="$2"; shift 2 ;;
        *)                err "Unknown option: $1" ;;
    esac
done

[[ -z "$PROJECT_DIR" ]] && err "--project-dir is required"
[[ -z "$SERVICE_LIST" ]] && err "--service-list is required"

PROJECT_NAME="${PROJECT_NAME:-$(basename "$PROJECT_DIR")}"

# ── CLAUDE.md Injection ──────────────────────────────────────────────────────

inject_claude_md() {
    local claude_md="$PROJECT_DIR/CLAUDE.md"
    local template="$ADAPTER_DIR/CLAUDE.md.template"

    if [[ ! -f "$template" ]]; then
        err "Template not found: $template"
    fi

    # Generate the Accord block from template
    local accord_block
    accord_block="$(cat "$template")"

    # Replace variables in the block
    local tmp_block
    tmp_block="$(mktemp)"
    echo "$accord_block" > "$tmp_block"
    replace_vars "$tmp_block" \
        "PROJECT_NAME" "$PROJECT_NAME" \
        "SERVICE_LIST" "$SERVICE_LIST"
    accord_block="$(cat "$tmp_block")"
    rm -f "$tmp_block"

    if [[ -f "$claude_md" ]]; then
        # Check for existing Accord block
        if grep -q "<!-- ACCORD START" "$claude_md"; then
            # Remove existing block and replace
            local tmp_file
            tmp_file="$(mktemp)"
            awk '
                /<!-- ACCORD START/ { skip=1; next }
                /<!-- ACCORD END/ { skip=0; next }
                !skip { print }
            ' "$claude_md" > "$tmp_file"

            # Append new block
            echo "" >> "$tmp_file"
            echo "$accord_block" >> "$tmp_file"
            mv "$tmp_file" "$claude_md"
            log "Updated Accord block in $claude_md"
        else
            # Append to existing CLAUDE.md
            echo "" >> "$claude_md"
            echo "$accord_block" >> "$claude_md"
            log "Appended Accord block to $claude_md"
        fi
    else
        # Create new CLAUDE.md
        echo "$accord_block" > "$claude_md"
        log "Created $claude_md with orchestrator rules"
    fi
}

# ── Slash Commands ───────────────────────────────────────────────────────────

install_commands() {
    local commands_src="$ADAPTER_DIR/commands"
    local commands_dest="$PROJECT_DIR/.claude/commands"

    mkdir -p "$commands_dest"

    for cmd_file in "$commands_src"/*.md; do
        [[ ! -f "$cmd_file" ]] && continue
        local filename
        filename="$(basename "$cmd_file")"
        local dest_file="$commands_dest/$filename"

        cp "$cmd_file" "$dest_file"
        replace_vars "$dest_file" \
            "PROJECT_NAME" "$PROJECT_NAME" \
            "SERVICE_LIST" "$SERVICE_LIST"

        log "Installed command: $filename"
    done
}

# ── Main ─────────────────────────────────────────────────────────────────────

log "Installing Claude Code orchestrator adapter for project: $PROJECT_NAME"

inject_claude_md
install_commands

log "Orchestrator adapter installation complete"
log "Slash commands available: /accord-decompose, /accord-route, /accord-monitor, /accord-check-inbox, /accord-remote, /accord-check-results"
