#!/usr/bin/env bash
# Installs the Claude Code adapter into a target project.
#
# Usage:
#   install.sh --project-dir <path> --team-name <name> --team-list <csv> [options]
#
# This script:
# 1. Injects Accord rules into the project's CLAUDE.md (idempotent, uses markers)
# 2. Copies slash commands to .claude/commands/
# 3. Copies the contract scanner skill to .claude/skills/

set -euo pipefail

ADAPTER_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────

PROJECT_DIR=""
PROJECT_NAME=""
TEAM_NAME=""
TEAM_LIST=""
MODULE_LIST=""
CONTRACTS_DIR="contracts/"
INTERNAL_CONTRACTS_DIR=""
COMMS_DIR=".agent-comms/"
SYNC_MODE="on-action"

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo "[accord/claude-code] $*"; }
warn() { echo "[accord/claude-code] WARNING: $*" >&2; }
err() { echo "[accord/claude-code] ERROR: $*" >&2; exit 1; }

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
        --project-dir)            PROJECT_DIR="$2"; shift 2 ;;
        --project-name)           PROJECT_NAME="$2"; shift 2 ;;
        --team-name)              TEAM_NAME="$2"; shift 2 ;;
        --team-list)              TEAM_LIST="$2"; shift 2 ;;
        --module-list)            MODULE_LIST="$2"; shift 2 ;;
        --contracts-dir)          CONTRACTS_DIR="$2"; shift 2 ;;
        --internal-contracts-dir) INTERNAL_CONTRACTS_DIR="$2"; shift 2 ;;
        --comms-dir)              COMMS_DIR="$2"; shift 2 ;;
        --sync-mode)              SYNC_MODE="$2"; shift 2 ;;
        *)                        err "Unknown option: $1" ;;
    esac
done

[[ -z "$PROJECT_DIR" ]] && err "--project-dir is required"
[[ -z "$TEAM_NAME" ]] && err "--team-name is required"
[[ -z "$TEAM_LIST" ]] && err "--team-list is required"

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
        "TEAM_NAME" "$TEAM_NAME" \
        "TEAM_LIST" "$TEAM_LIST" \
        "MODULE_LIST" "${MODULE_LIST:-none}" \
        "CONTRACTS_DIR" "$CONTRACTS_DIR" \
        "INTERNAL_CONTRACTS_DIR" "${INTERNAL_CONTRACTS_DIR:-N/A}" \
        "COMMS_DIR" "$COMMS_DIR" \
        "SYNC_MODE" "$SYNC_MODE"
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
        log "Created $claude_md with Accord rules"
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
            "TEAM_NAME" "$TEAM_NAME" \
            "TEAM_LIST" "$TEAM_LIST" \
            "MODULE_LIST" "${MODULE_LIST:-none}" \
            "CONTRACTS_DIR" "$CONTRACTS_DIR" \
            "INTERNAL_CONTRACTS_DIR" "${INTERNAL_CONTRACTS_DIR:-N/A}" \
            "COMMS_DIR" "$COMMS_DIR"

        log "Installed command: $filename"
    done
}

# ── Scanner Skill ────────────────────────────────────────────────────────────

install_scanner_skill() {
    local skill_src="$ADAPTER_DIR/skills/contract-scanner"
    local skill_dest="$PROJECT_DIR/.claude/skills/contract-scanner"

    if [[ ! -d "$skill_src" ]]; then
        warn "Scanner skill not found at $skill_src (skipping)"
        return
    fi

    mkdir -p "$skill_dest"

    for skill_file in "$skill_src"/*.md; do
        [[ ! -f "$skill_file" ]] && continue
        local filename
        filename="$(basename "$skill_file")"
        cp "$skill_file" "$skill_dest/$filename"
        log "Installed skill: contract-scanner/$filename"
    done
}

# ── Main ─────────────────────────────────────────────────────────────────────

log "Installing Claude Code adapter for team: $TEAM_NAME"

inject_claude_md
install_commands
install_scanner_skill

log "Claude Code adapter installation complete"
log "Slash commands available: /check-inbox, /send-request, /complete-request, /accord-scan"
