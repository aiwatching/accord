#!/usr/bin/env bash
# Accord Lite — Project Initialization Script
#
# Scaffolds .accord/ structure, copies skills + commands, and injects CLAUDE.md section.
#
# Usage:
#   cd your-project && ~/.accord/init.sh                  # Standard install
#   cd your-project && /path/to/accord/init.sh            # From local clone
#   cd your-project && ~/.accord/init.sh --force          # Overwrite existing files
#   cd your-project && ~/.accord/init.sh --skip-claude-md # Don't touch CLAUDE.md

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$(pwd)"
FORCE=false
SKIP_CLAUDE_MD=false

# ── Colors ────────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log()  { echo -e "${CYAN}[accord]${NC} $*"; }
warn() { echo -e "${YELLOW}[accord] WARN:${NC} $*"; }
err()  { echo -e "${RED}[accord] ERROR:${NC} $*" >&2; exit 1; }
ok()   { echo -e "${GREEN}[accord]${NC} $*"; }

# ── Parse Arguments ───────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --force)         FORCE=true; shift ;;
        --skip-claude-md) SKIP_CLAUDE_MD=true; shift ;;
        --target)        TARGET_DIR="$2"; shift 2 ;;
        -h|--help)
            cat <<'HELP'
Usage: init.sh [options]

Run in your project directory to set up Accord Lite.

Options:
  --force          Overwrite existing Accord files
  --skip-claude-md Don't modify CLAUDE.md
  --target <dir>   Initialize in a specific directory (default: current dir)
  -h, --help       Show this help

What it does:
  1. Creates .accord/ directory structure
  2. Copies skills to .claude/skills/
  3. Copies commands to .claude/commands/
  4. Appends Accord Lite section to CLAUDE.md
HELP
            exit 0 ;;
        *) err "Unknown option: $1. Use --help for usage." ;;
    esac
done

# ── Validate ──────────────────────────────────────────────────────────────────

if [[ ! -d "$TARGET_DIR" ]]; then
    err "Target directory does not exist: $TARGET_DIR"
fi

cd "$TARGET_DIR"
TARGET_DIR="$(pwd)"

if [[ -d "$TARGET_DIR/.accord" ]] && [[ "$FORCE" != true ]]; then
    warn ".accord/ already exists. Use --force to overwrite."
    warn "Skills and commands will not be overwritten without --force."
fi

# ── Verify source files exist ─────────────────────────────────────────────────

for required in skills/accord-scan/SKILL.md skills/accord-architect/SKILL.md \
                templates/claude-section.md.template templates/module-map.yaml.template; do
    if [[ ! -f "$ACCORD_DIR/$required" ]]; then
        err "Missing required file: $ACCORD_DIR/$required"
    fi
done

# ── Create .accord/ structure ─────────────────────────────────────────────────

log "Creating .accord/ structure..."

mkdir -p "$TARGET_DIR/.accord/contracts"
mkdir -p "$TARGET_DIR/.accord/plans/archive"

# Create module-map.yaml stub (only if not exists or --force)
if [[ ! -f "$TARGET_DIR/.accord/module-map.yaml" ]] || [[ "$FORCE" == true ]]; then
    # Detect project name from directory or git
    PROJECT_NAME="$(basename "$TARGET_DIR")"
    if [[ -d "$TARGET_DIR/.git" ]]; then
        local_name="$(git -C "$TARGET_DIR" remote get-url origin 2>/dev/null | sed 's|.*/||; s|\.git$||')" || true
        if [[ -n "${local_name:-}" ]]; then
            PROJECT_NAME="$local_name"
        fi
    fi

    cat > "$TARGET_DIR/.accord/module-map.yaml" <<YAML
version: "0.1"
scanned_at: ""
project:
  name: "$PROJECT_NAME"
  root: "."

modules: {}

build_order: []
YAML
    ok "Created .accord/module-map.yaml"
fi

# Create ARCHITECTURE.md stub (only if not exists or --force)
if [[ ! -f "$TARGET_DIR/.accord/ARCHITECTURE.md" ]] || [[ "$FORCE" == true ]]; then
    cat > "$TARGET_DIR/.accord/ARCHITECTURE.md" <<'MD'
# Architecture

> Run `/accord-scan full` to populate this file.
MD
    ok "Created .accord/ARCHITECTURE.md"
fi

# ── Copy Skills ───────────────────────────────────────────────────────────────

log "Installing skills..."

copy_skill() {
    local skill_name="$1"
    local src="$ACCORD_DIR/skills/$skill_name/SKILL.md"
    local dst_dir="$TARGET_DIR/.claude/skills/$skill_name"
    local dst="$dst_dir/SKILL.md"

    mkdir -p "$dst_dir"
    if [[ ! -f "$dst" ]] || [[ "$FORCE" == true ]]; then
        cp "$src" "$dst"
        ok "Installed skill: $skill_name"
    else
        warn "Skill $skill_name already exists (use --force to overwrite)"
    fi
}

copy_skill "accord-scan"
copy_skill "accord-architect"

# ── Copy Commands ─────────────────────────────────────────────────────────────

log "Installing commands..."

copy_command() {
    local cmd_name="$1"
    local src="$ACCORD_DIR/commands/$cmd_name.md"
    local dst_dir="$TARGET_DIR/.claude/commands"
    local dst="$dst_dir/$cmd_name.md"

    mkdir -p "$dst_dir"
    if [[ ! -f "$dst" ]] || [[ "$FORCE" == true ]]; then
        cp "$src" "$dst"
        ok "Installed command: /$cmd_name"
    else
        warn "Command $cmd_name already exists (use --force to overwrite)"
    fi
}

copy_command "accord-scan"
copy_command "accord-plan"
copy_command "accord-execute"
copy_command "accord-status"
copy_command "accord-replan"

# ── Inject CLAUDE.md section ─────────────────────────────────────────────────

if [[ "$SKIP_CLAUDE_MD" != true ]]; then
    log "Updating CLAUDE.md..."

    CLAUDE_MD="$TARGET_DIR/CLAUDE.md"
    MARKER="## Accord Lite"

    if [[ -f "$CLAUDE_MD" ]]; then
        if grep -qF "$MARKER" "$CLAUDE_MD"; then
            if [[ "$FORCE" == true ]]; then
                # Remove old Accord Lite section and re-append
                # Find the line with the marker and remove everything from there to end
                local_tmp="$(mktemp)"
                awk -v marker="$MARKER" '
                    $0 ~ marker { found=1 }
                    !found { print }
                ' "$CLAUDE_MD" > "$local_tmp"
                mv "$local_tmp" "$CLAUDE_MD"
                echo "" >> "$CLAUDE_MD"
                cat "$ACCORD_DIR/templates/claude-section.md.template" >> "$CLAUDE_MD"
                ok "Updated Accord Lite section in CLAUDE.md"
            else
                warn "Accord Lite section already exists in CLAUDE.md (use --force to update)"
            fi
        else
            echo "" >> "$CLAUDE_MD"
            cat "$ACCORD_DIR/templates/claude-section.md.template" >> "$CLAUDE_MD"
            ok "Appended Accord Lite section to CLAUDE.md"
        fi
    else
        cat "$ACCORD_DIR/templates/claude-section.md.template" > "$CLAUDE_MD"
        ok "Created CLAUDE.md with Accord Lite section"
    fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}Accord Lite initialized!${NC}"
echo ""
echo "Installed:"
echo "  .accord/                     Knowledge base directory"
echo "  .claude/skills/              Scan + Architect skills"
echo "  .claude/commands/            5 slash commands"
if [[ "$SKIP_CLAUDE_MD" != true ]]; then
    echo "  CLAUDE.md                    Updated with Accord Lite rules"
fi
echo ""
echo -e "${BOLD}Next step:${NC}"
echo -e "  Run ${CYAN}/accord-scan full${NC} in Claude Code to build your knowledge base."
echo ""
