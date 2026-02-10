#!/usr/bin/env bash
# Accord Uninstall Script
# Removes Accord infrastructure from a project.
#
# Usage:
#   ~/.accord/uninstall.sh                  # Interactive — shows what will be removed
#   ~/.accord/uninstall.sh --force          # No confirmation prompt
#   ~/.accord/uninstall.sh --keep-contracts # Remove Accord but keep contracts/
#
# Run in the project directory, or specify --target-dir <path>.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────

TARGET_DIR="."
FORCE=false
KEEP_CONTRACTS=false

GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo -e "[accord] $*"; }
warn() { echo -e "[accord] ${RED}WARNING:${NC} $*" >&2; }
err() { echo -e "[accord] ${RED}ERROR:${NC} $*" >&2; exit 1; }

# ── Argument Parsing ─────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target-dir)      TARGET_DIR="$2"; shift 2 ;;
        --force)           FORCE=true; shift ;;
        --keep-contracts)  KEEP_CONTRACTS=true; shift ;;
        --help)
            echo "Usage: uninstall.sh [--target-dir <path>] [--force] [--keep-contracts]"
            echo ""
            echo "Options:"
            echo "  --target-dir <path>   Project directory (default: current directory)"
            echo "  --force               Skip confirmation prompt"
            echo "  --keep-contracts      Remove Accord infrastructure but keep contracts/"
            exit 0
            ;;
        *) err "Unknown option: $1. Use --help for usage." ;;
    esac
done

TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

# ── Detect Accord installation ───────────────────────────────────────────────

if [[ ! -d "$TARGET_DIR/.accord" && ! -d "$TARGET_DIR/.agent-comms" ]]; then
    err "No Accord installation found in $TARGET_DIR"
fi

# Read config to discover service/module structure
SERVICE=""
if [[ -f "$TARGET_DIR/.accord/config.yaml" ]]; then
    # Find team directories that have .accord subdirectories (service with modules)
    IFS=',' read -ra teams <<< "$(sed -n 's/^  - name: //p' "$TARGET_DIR/.accord/config.yaml" | tr '\n' ',' | sed 's/,$//')"
    for team in "${teams[@]}"; do
        team="$(echo "$team" | xargs)"
        if [[ -d "$TARGET_DIR/$team/.accord" || -d "$TARGET_DIR/$team/.agent-comms" ]]; then
            SERVICE="$team"
            break
        fi
    done
fi

# ── Build removal list ───────────────────────────────────────────────────────

REMOVE_DIRS=()
REMOVE_FILES=()
MODIFY_FILES=()

# Core Accord directories
[[ -d "$TARGET_DIR/.accord" ]] && REMOVE_DIRS+=(".accord/")
[[ -d "$TARGET_DIR/.agent-comms" ]] && REMOVE_DIRS+=(".agent-comms/")

# Contracts
if [[ "$KEEP_CONTRACTS" == false && -d "$TARGET_DIR/contracts" ]]; then
    REMOVE_DIRS+=("contracts/")
fi

# Service-level directories
if [[ -n "$SERVICE" ]]; then
    [[ -d "$TARGET_DIR/$SERVICE/.accord" ]] && REMOVE_DIRS+=("$SERVICE/.accord/")
    [[ -d "$TARGET_DIR/$SERVICE/.agent-comms" ]] && REMOVE_DIRS+=("$SERVICE/.agent-comms/")
    # Module-level .accord dirs
    for mod_dir in "$TARGET_DIR/$SERVICE"/*/; do
        [[ ! -d "$mod_dir" ]] && continue
        local_name="$(basename "$mod_dir")"
        if [[ -d "$mod_dir/.accord" ]]; then
            REMOVE_DIRS+=("$SERVICE/$local_name/.accord/")
        fi
    done
fi

# Claude Code adapter files
ACCORD_COMMANDS=(
    "accord-dispatch.md" "accord-init.md" "accord-scan.md"
    "accord-status.md" "accord-validate.md"
    "check-inbox.md" "send-request.md" "complete-request.md"
)
for cmd in "${ACCORD_COMMANDS[@]}"; do
    if [[ -f "$TARGET_DIR/.claude/commands/$cmd" ]]; then
        REMOVE_FILES+=(".claude/commands/$cmd")
    fi
done

# Scanner skill
if [[ -d "$TARGET_DIR/.claude/skills/contract-scanner" ]]; then
    REMOVE_DIRS+=(".claude/skills/contract-scanner/")
fi

# CLAUDE.md — remove ACCORD block (modify, not delete)
if [[ -f "$TARGET_DIR/CLAUDE.md" ]] && grep -q "<!-- ACCORD START" "$TARGET_DIR/CLAUDE.md"; then
    MODIFY_FILES+=("CLAUDE.md (remove Accord block)")
fi

# Generic adapter instructions
if [[ -f "$TARGET_DIR/.accord/adapter/AGENT_INSTRUCTIONS.md" ]]; then
    # Already covered by .accord/ removal
    :
fi

# ── Display plan ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}=== Accord Uninstall ===${NC}"
echo ""
echo -e "  Project: ${GREEN}$(basename "$TARGET_DIR")${NC} ($TARGET_DIR)"
echo ""

if [[ "${#REMOVE_DIRS[@]}" -gt 0 ]]; then
    echo -e "  ${RED}Remove directories:${NC}"
    for d in "${REMOVE_DIRS[@]+"${REMOVE_DIRS[@]}"}"; do
        echo "    - $d"
    done
fi

if [[ "${#REMOVE_FILES[@]}" -gt 0 ]]; then
    echo -e "  ${RED}Remove files:${NC}"
    for f in "${REMOVE_FILES[@]+"${REMOVE_FILES[@]}"}"; do
        echo "    - $f"
    done
fi

if [[ "${#MODIFY_FILES[@]}" -gt 0 ]]; then
    echo -e "  ${DIM}Modify files:${NC}"
    for f in "${MODIFY_FILES[@]+"${MODIFY_FILES[@]}"}"; do
        echo "    - $f"
    done
fi

if [[ "$KEEP_CONTRACTS" == true && -d "$TARGET_DIR/contracts" ]]; then
    echo ""
    echo -e "  ${GREEN}Keeping:${NC} contracts/ (--keep-contracts)"
fi

echo ""

# ── Confirm ──────────────────────────────────────────────────────────────────

if [[ "$FORCE" == false ]]; then
    read -r -p "  Proceed with uninstall? (y/n) [n]: " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo "  Cancelled."
        exit 0
    fi
fi

# ── Execute removal ──────────────────────────────────────────────────────────

# Remove directories
for d in "${REMOVE_DIRS[@]+"${REMOVE_DIRS[@]}"}"; do
    [[ -z "$d" ]] && continue
    rm -rf "$TARGET_DIR/$d"
    log "Removed $d"
done

# Remove files
for f in "${REMOVE_FILES[@]+"${REMOVE_FILES[@]}"}"; do
    [[ -z "$f" ]] && continue
    rm -f "$TARGET_DIR/$f"
    log "Removed $f"
done

# Clean CLAUDE.md — remove ACCORD block, keep everything else
if [[ -f "$TARGET_DIR/CLAUDE.md" ]] && grep -q "<!-- ACCORD START" "$TARGET_DIR/CLAUDE.md"; then
    tmp_file="$(mktemp)"
    awk '
        /<!-- ACCORD START/ { skip=1; next }
        /<!-- ACCORD END/ { skip=0; next }
        !skip { print }
    ' "$TARGET_DIR/CLAUDE.md" > "$tmp_file"

    # Remove trailing blank lines (awk for macOS/Linux portability)
    awk '
        { lines[NR] = $0 }
        /./ { last = NR }
        END { for (i = 1; i <= last; i++) print lines[i] }
    ' "$tmp_file" > "$tmp_file.clean"
    mv "$tmp_file.clean" "$TARGET_DIR/CLAUDE.md"
    rm -f "$tmp_file"

    # If CLAUDE.md is now empty, remove it
    if [[ ! -s "$TARGET_DIR/CLAUDE.md" ]]; then
        rm -f "$TARGET_DIR/CLAUDE.md"
        log "Removed CLAUDE.md (was Accord-only)"
    else
        log "Removed Accord block from CLAUDE.md"
    fi
fi

# Clean up empty parent directories
if [[ -d "$TARGET_DIR/.claude/commands" ]] && [ -z "$(ls -A "$TARGET_DIR/.claude/commands" 2>/dev/null)" ]; then
    rmdir "$TARGET_DIR/.claude/commands" 2>/dev/null || true
fi
if [[ -d "$TARGET_DIR/.claude/skills" ]] && [ -z "$(ls -A "$TARGET_DIR/.claude/skills" 2>/dev/null)" ]; then
    rmdir "$TARGET_DIR/.claude/skills" 2>/dev/null || true
fi

echo ""
echo -e "${BOLD}=== Accord uninstalled ===${NC}"
echo ""
if [[ "$KEEP_CONTRACTS" == true ]]; then
    echo "  Contracts preserved in contracts/. Remove manually if no longer needed."
else
    echo "  All Accord files removed."
fi
echo ""
