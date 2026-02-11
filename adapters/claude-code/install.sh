#!/usr/bin/env bash
# Installs the Claude Code adapter into a target project.
#
# Usage:
#   install.sh --project-dir <path> --service-list <csv> [options]
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
SERVICE_NAME=""
SERVICE_LIST=""
MODULE_LIST=""
CONTRACTS_DIR=".accord/contracts/"
INTERNAL_CONTRACTS_DIR=".accord/contracts/internal/"
COMMS_DIR=".accord/comms/"
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
        --service-name)           SERVICE_NAME="$2"; shift 2 ;;
        --service-list)           SERVICE_LIST="$2"; shift 2 ;;
        --module-list)            MODULE_LIST="$2"; shift 2 ;;
        --contracts-dir)          CONTRACTS_DIR="$2"; shift 2 ;;
        --internal-contracts-dir) INTERNAL_CONTRACTS_DIR="$2"; shift 2 ;;
        --comms-dir)              COMMS_DIR="$2"; shift 2 ;;
        --sync-mode)              SYNC_MODE="$2"; shift 2 ;;
        *)                        err "Unknown option: $1" ;;
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
        "SERVICE_LIST" "$SERVICE_LIST" \
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

    # Clean up old command filenames (pre-rename: without accord- prefix)
    local OLD_COMMANDS=("check-inbox.md" "send-request.md" "complete-request.md")
    for old_cmd in "${OLD_COMMANDS[@]}"; do
        if [[ -f "$commands_dest/$old_cmd" ]]; then
            rm -f "$commands_dest/$old_cmd"
            log "Removed old command: $old_cmd (renamed to accord-$old_cmd)"
        fi
    done

    for cmd_file in "$commands_src"/*.md; do
        [[ ! -f "$cmd_file" ]] && continue
        local filename
        filename="$(basename "$cmd_file")"
        local dest_file="$commands_dest/$filename"

        cp "$cmd_file" "$dest_file"
        replace_vars "$dest_file" \
            "PROJECT_NAME" "$PROJECT_NAME" \
            "SERVICE_LIST" "$SERVICE_LIST" \
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

# ── Hooks (auto-sync via Claude Code native hooks) ─────────────────────────

install_hooks() {
    local hooks_src="$ADAPTER_DIR/hooks"
    local hooks_dest="$PROJECT_DIR/.accord/hooks"

    if [[ ! -d "$hooks_src" ]]; then
        warn "Hooks directory not found at $hooks_src (skipping)"
        return
    fi

    # Copy hook script
    mkdir -p "$hooks_dest"
    for hook_file in "$hooks_src"/*.sh; do
        [[ ! -f "$hook_file" ]] && continue
        local filename
        filename="$(basename "$hook_file")"
        cp "$hook_file" "$hooks_dest/$filename"
        chmod +x "$hooks_dest/$filename"
        log "Installed hook: $filename"
    done

    # Generate .claude/settings.json with hooks config
    local settings_dir="$PROJECT_DIR/.claude"
    local settings_file="$settings_dir/settings.json"
    mkdir -p "$settings_dir"

    # Build hooks array based on sync mode
    local hooks_json=""
    case "$SYNC_MODE" in
        on-action)
            hooks_json='[{"matcher":"SessionStart","hooks":[{"type":"command","command":"bash .accord/hooks/accord-auto-sync.sh"}]}]'
            ;;
        auto-poll)
            hooks_json='[{"matcher":"SessionStart","hooks":[{"type":"command","command":"bash .accord/hooks/accord-auto-sync.sh"}]},{"matcher":"Stop","hooks":[{"type":"command","command":"bash .accord/hooks/accord-auto-sync.sh"}]}]'
            ;;
        manual)
            # No hooks for manual mode
            return
            ;;
    esac

    if [[ -f "$settings_file" ]]; then
        # Merge hooks into existing settings.json
        python3 -c "
import json, sys

with open('$settings_file', 'r') as f:
    settings = json.load(f)

new_hooks = json.loads('$hooks_json')
settings['hooks'] = new_hooks

with open('$settings_file', 'w') as f:
    json.dump(settings, f, indent=2)
    f.write('\n')
" 2>/dev/null || {
            warn "Failed to merge hooks into existing settings.json"
            return
        }
        log "Merged hooks into existing $settings_file"
    else
        # Create new settings.json
        python3 -c "
import json

settings = {'hooks': json.loads('$hooks_json')}
with open('$settings_file', 'w') as f:
    json.dump(settings, f, indent=2)
    f.write('\n')
" 2>/dev/null || {
            warn "Failed to create settings.json"
            return
        }
        log "Created $settings_file with hooks config"
    fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

log "Installing Claude Code adapter for project: $PROJECT_NAME"

inject_claude_md
install_commands
install_scanner_skill
install_hooks

log "Claude Code adapter installation complete"
log "Slash commands available: /accord-check-inbox, /accord-send-request, /accord-complete-request, /accord-scan, /accord-sync"
