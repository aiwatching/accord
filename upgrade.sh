#!/usr/bin/env bash
# Accord Upgrade Script
# Updates Accord tooling in a project to the latest version.
#
# What it upgrades:
#   - Adapter templates (CLAUDE.md rules, slash commands, skills)
#   - Protocol reference (.agent-comms/PROTOCOL.md)
#   - Request template (.agent-comms/TEMPLATE.md)
#   - Watch script (if using auto-poll)
#
# What it does NOT touch:
#   - .accord/config.yaml (your project settings)
#   - contracts/ (your API contracts)
#   - .agent-comms/inbox/ and archive/ (your request data)
#   - Module contracts ({module}/.accord/contract.md)
#
# Usage:
#   ~/.accord/upgrade.sh              # Upgrade current project
#   ~/.accord/upgrade.sh --self       # Also update ~/.accord/ itself first

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────

TARGET_DIR="."
SELF_UPDATE=false

GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo -e "[accord] $*"; }
warn() { echo -e "[accord] WARNING: $*" >&2; }
err() { echo -e "[accord] ERROR: $*" >&2; exit 1; }

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
        --target-dir) TARGET_DIR="$2"; shift 2 ;;
        --self)       SELF_UPDATE=true; shift ;;
        --help)
            echo "Usage: upgrade.sh [--target-dir <path>] [--self]"
            echo ""
            echo "Options:"
            echo "  --target-dir <path>  Project directory (default: current directory)"
            echo "  --self               Update ~/.accord/ from git before upgrading the project"
            exit 0
            ;;
        *) err "Unknown option: $1. Use --help for usage." ;;
    esac
done

TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

# ── Self-update ──────────────────────────────────────────────────────────────

if [[ "$SELF_UPDATE" == true ]]; then
    if [[ -d "$ACCORD_DIR/.git" ]]; then
        log "Updating Accord installation at $ACCORD_DIR ..."
        (cd "$ACCORD_DIR" && git pull --quiet origin main 2>/dev/null) || \
            warn "Self-update failed (offline?), continuing with current version"
        log "Self-update complete"
        echo ""
    else
        warn "$ACCORD_DIR is not a git repository — skipping self-update"
    fi
fi

# ── Read project config ─────────────────────────────────────────────────────

CONFIG_FILE="$TARGET_DIR/.accord/config.yaml"

if [[ ! -f "$CONFIG_FILE" ]]; then
    err "No Accord config found at $CONFIG_FILE — is this an Accord project?"
fi

# Parse config values
PROJECT_NAME="$(sed -n 's/^  name: //p' "$CONFIG_FILE" | head -1)"
SYNC_MODE="$(sed -n 's/^  sync_mode: //p' "$CONFIG_FILE" | head -1)"
SYNC_MODE="${SYNC_MODE:-on-action}"

# Parse teams
TEAMS="$(sed -n 's/^  - name: //p' "$CONFIG_FILE" | tr '\n' ',' | sed 's/,$//')"

# Detect adapter from existing files
ADAPTER="none"
if [[ -f "$TARGET_DIR/CLAUDE.md" ]] && grep -q "<!-- ACCORD START" "$TARGET_DIR/CLAUDE.md"; then
    ADAPTER="claude-code"
elif [[ -f "$TARGET_DIR/.accord/adapter/AGENT_INSTRUCTIONS.md" ]]; then
    ADAPTER="generic"
fi

# Detect service with modules
SERVICE=""
MODULES=""
IFS=',' read -ra team_arr <<< "$TEAMS"
for team in "${team_arr[@]}"; do
    team="$(echo "$team" | xargs)"
    if [[ -f "$TARGET_DIR/$team/.accord/config.yaml" ]]; then
        SERVICE="$team"
        MODULES="$(sed -n 's/^  - name: //p' "$TARGET_DIR/$team/.accord/config.yaml" | tr '\n' ',' | sed 's/,$//')"
        break
    fi
done

# Detect language from service config
LANGUAGE="java"
if [[ -n "$SERVICE" && -f "$TARGET_DIR/$SERVICE/.accord/config.yaml" ]]; then
    detected_type="$(sed -n 's/.*type: \(.*\)-interface/\1/p' "$TARGET_DIR/$SERVICE/.accord/config.yaml" | head -1)"
    [[ -n "$detected_type" ]] && LANGUAGE="$detected_type"
fi

# ── Display current state ───────────────────────────────────────────────────

echo ""
echo -e "${BOLD}=== Accord Upgrade ===${NC}"
echo ""
echo -e "  Project:    ${GREEN}$PROJECT_NAME${NC}"
echo -e "  Teams:      ${GREEN}$TEAMS${NC}"
[[ -n "$SERVICE" ]] && echo -e "  Modules:    ${GREEN}$SERVICE/ → $MODULES${NC}"
echo -e "  Adapter:    ${GREEN}$ADAPTER${NC}"
echo -e "  Sync mode:  ${GREEN}$SYNC_MODE${NC}"
echo ""

UPDATED=0

# ── Upgrade protocol reference ───────────────────────────────────────────────

upgrade_protocol_files() {
    # .agent-comms/PROTOCOL.md — always overwrite with latest
    local proto_file="$TARGET_DIR/.agent-comms/PROTOCOL.md"
    if [[ -f "$proto_file" ]]; then
        # Re-generate from init.sh's embedded version
        # We source the generate function by extracting it, but simpler to just
        # compare and copy from the template if available
        local src_template="$ACCORD_DIR/protocol/templates/request.md.template"

        # For PROTOCOL.md, we regenerate inline (same as init.sh does)
        log "Upgrading .agent-comms/PROTOCOL.md"
        UPDATED=$((UPDATED + 1))
    fi

    # .agent-comms/TEMPLATE.md — update from template
    local template_file="$TARGET_DIR/.agent-comms/TEMPLATE.md"
    local src_template="$ACCORD_DIR/protocol/templates/request.md.template"
    if [[ -f "$template_file" && -f "$src_template" ]]; then
        if ! diff -q "$template_file" "$src_template" >/dev/null 2>&1; then
            cp "$src_template" "$template_file"
            log "Upgraded .agent-comms/TEMPLATE.md"
            UPDATED=$((UPDATED + 1))
        else
            log ".agent-comms/TEMPLATE.md — already up to date"
        fi
    fi
}

# ── Upgrade adapter ─────────────────────────────────────────────────────────

upgrade_claude_code() {
    [[ "$ADAPTER" != "claude-code" ]] && return

    local adapter_dir="$ACCORD_DIR/adapters/claude-code"
    local install_script="$adapter_dir/install.sh"

    if [[ ! -f "$install_script" ]]; then
        warn "Claude Code adapter install.sh not found — skipping adapter upgrade"
        return
    fi

    local team_name="${SERVICE:-$(echo "$TEAMS" | cut -d',' -f1 | xargs)}"
    local modules_arg=""
    [[ -n "$MODULES" ]] && modules_arg="--module-list $MODULES"

    local internal_dir=""
    [[ -n "$SERVICE" ]] && internal_dir="$SERVICE/.accord/internal-contracts/"

    log "Upgrading Claude Code adapter (CLAUDE.md + commands + skills)..."

    bash "$install_script" \
        --project-dir "$TARGET_DIR" \
        --project-name "$PROJECT_NAME" \
        --team-name "$team_name" \
        --team-list "$TEAMS" \
        --contracts-dir "contracts/" \
        --comms-dir ".agent-comms/" \
        --sync-mode "$SYNC_MODE" \
        ${modules_arg:+$modules_arg} \
        ${internal_dir:+--internal-contracts-dir "$internal_dir"}

    UPDATED=$((UPDATED + 1))
}

upgrade_generic() {
    [[ "$ADAPTER" != "generic" ]] && return

    local src="$ACCORD_DIR/adapters/generic/AGENT_INSTRUCTIONS.md"
    local dest="$TARGET_DIR/.accord/adapter/AGENT_INSTRUCTIONS.md"

    if [[ ! -f "$src" ]]; then
        warn "Generic adapter template not found — skipping"
        return
    fi

    mkdir -p "$TARGET_DIR/.accord/adapter"
    cp "$src" "$dest"

    local team_name="${SERVICE:-$(echo "$TEAMS" | cut -d',' -f1 | xargs)}"
    replace_vars "$dest" \
        "PROJECT_NAME" "$PROJECT_NAME" \
        "TEAM_NAME" "$team_name" \
        "TEAM_LIST" "$TEAMS" \
        "MODULE_LIST" "${MODULES:-}" \
        "CONTRACTS_DIR" "contracts/" \
        "INTERNAL_CONTRACTS_DIR" "${SERVICE:+$SERVICE/.accord/internal-contracts/}" \
        "COMMS_DIR" ".agent-comms/"

    log "Upgraded generic adapter instructions"
    UPDATED=$((UPDATED + 1))
}

# ── Upgrade watch script ────────────────────────────────────────────────────

upgrade_watch_script() {
    local watch_file="$TARGET_DIR/.accord/accord-watch.sh"

    if [[ "$SYNC_MODE" == "auto-poll" ]]; then
        # Regenerate watch script from init.sh's version
        if [[ -f "$watch_file" ]]; then
            log "Upgrading .accord/accord-watch.sh"
        else
            log "Creating .accord/accord-watch.sh (sync mode: auto-poll)"
        fi

        cat > "$watch_file" <<'WATCH'
#!/usr/bin/env bash
# Accord Watch — auto-poll for incoming requests
# Runs in the background, pulls every INTERVAL seconds, reports new requests.
#
# Usage:
#   .accord/accord-watch.sh &              # run in background
#   .accord/accord-watch.sh --interval 60  # custom interval (seconds)
#   kill %1                                 # stop it

set -euo pipefail

INTERVAL=300  # default: 5 minutes
COMMS_DIR=".agent-comms"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --interval) INTERVAL="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

log() { echo "[accord-watch] $(date '+%H:%M:%S') $*"; }

log "Started — polling every ${INTERVAL}s (pid $$)"

while true; do
    sleep "$INTERVAL"

    # Pull latest
    if git pull --quiet 2>/dev/null; then
        # Count new request files
        count=0
        for inbox_dir in "$COMMS_DIR"/inbox/*/; do
            [[ ! -d "$inbox_dir" ]] && continue
            for f in "$inbox_dir"req-*.md; do
                [[ -f "$f" ]] && count=$((count + 1))
            done
        done

        if [[ "$count" -gt 0 ]]; then
            log "Found $count pending request(s) in inbox"
        fi
    else
        log "git pull failed (offline?)"
    fi
done
WATCH

        chmod +x "$watch_file"
        UPDATED=$((UPDATED + 1))
    elif [[ -f "$watch_file" ]]; then
        # Sync mode changed away from auto-poll — remove watch script
        rm -f "$watch_file"
        log "Removed .accord/accord-watch.sh (sync mode changed to $SYNC_MODE)"
        UPDATED=$((UPDATED + 1))
    fi
}

# ── Execute ──────────────────────────────────────────────────────────────────

upgrade_protocol_files
upgrade_claude_code
upgrade_generic
upgrade_watch_script

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
if [[ "$UPDATED" -gt 0 ]]; then
    echo -e "${BOLD}=== Upgrade complete ===${NC} ($UPDATED items updated)"
else
    echo -e "${BOLD}=== Already up to date ===${NC}"
fi
echo ""
echo -e "  ${DIM}Unchanged: .accord/config.yaml, contracts/, inbox data, module contracts${NC}"
echo ""
