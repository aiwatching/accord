#!/usr/bin/env bash
# Accord Upgrade Script
#
# Automatically pulls the latest Accord version and upgrades the project.
#
# What it upgrades:
#   - Accord framework at ~/.accord/ (auto-pull latest version)
#   - Adapter templates (CLAUDE.md rules, slash commands, skills)
#   - Protocol reference (.accord/comms/PROTOCOL.md)
#   - Request template (.accord/comms/TEMPLATE.md)
#   - Watch script (if using auto-poll)
#
# What it does NOT touch:
#   - .accord/config.yaml (your project settings)
#   - .accord/contracts/ (your API contracts)
#   - .accord/comms/inbox/ and archive/ (your request data)
#
# Usage:
#   ~/.accord/upgrade.sh                    # Upgrade current project (auto-pulls latest)
#   ~/.accord/upgrade.sh --version v0.2.0   # Upgrade to a specific version
#   ~/.accord/upgrade.sh --offline          # Skip auto-pull, use current local version

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────

TARGET_DIR="."
REQUESTED_VERSION="latest"
OFFLINE=false

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo -e "[accord] $*"; }
warn() { echo -e "${YELLOW}[accord] WARNING:${NC} $*" >&2; }
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

get_version() {
    local dir="$1"
    if [[ -f "$dir/VERSION" ]]; then
        cat "$dir/VERSION" | tr -d '[:space:]'
    else
        echo "unknown"
    fi
}

# ── Argument Parsing ─────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target-dir) TARGET_DIR="$2"; shift 2 ;;
        --version)    REQUESTED_VERSION="$2"; shift 2 ;;
        --offline)    OFFLINE=true; shift ;;
        --help)
            echo "Usage: upgrade.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --target-dir <path>    Project directory (default: current directory)"
            echo "  --version <version>    Upgrade to specific version (e.g., v0.2.0)"
            echo "  --offline              Skip auto-pull, use current local version"
            echo "  --help                 Show this help"
            echo ""
            echo "Examples:"
            echo "  ~/.accord/upgrade.sh                    # Auto-pull latest + upgrade"
            echo "  ~/.accord/upgrade.sh --version v0.2.0   # Upgrade to specific version"
            echo "  ~/.accord/upgrade.sh --offline           # Upgrade without pulling"
            exit 0
            ;;
        *)
            # Accept positional arg as target dir
            if [[ -d "$1" ]]; then
                TARGET_DIR="$1"; shift
            else
                err "Unknown option: $1. Use --help for usage."
            fi
            ;;
    esac
done

TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

# ── Step 1: Self-update (pull latest Accord framework) ───────────────────────

CURRENT_VERSION="$(get_version "$ACCORD_DIR")"

echo ""
echo -e "${BOLD}=== Accord Upgrade ===${NC}"
echo ""

if [[ "$OFFLINE" == true ]]; then
    log "Offline mode — skipping framework update"
    log "Using Accord v${CURRENT_VERSION}"
elif [[ -d "$ACCORD_DIR/.git" ]]; then
    log "Checking for updates..."

    (
        cd "$ACCORD_DIR"
        git fetch --quiet --tags origin 2>/dev/null
    ) || {
        warn "Failed to fetch updates (offline?), continuing with v${CURRENT_VERSION}"
        OFFLINE=true
    }

    if [[ "$OFFLINE" != true ]]; then
        if [[ "$REQUESTED_VERSION" == "latest" ]]; then
            # Find latest tag
            LATEST_TAG="$(cd "$ACCORD_DIR" && git tag --sort=-v:refname 'v*' 2>/dev/null | head -1)"
            if [[ -n "$LATEST_TAG" ]]; then
                REQUESTED_VERSION="$LATEST_TAG"
            else
                REQUESTED_VERSION="main"
            fi
        fi

        if [[ "$REQUESTED_VERSION" == "main" ]]; then
            (cd "$ACCORD_DIR" && git checkout --quiet main 2>/dev/null && git pull --quiet origin main 2>/dev/null) || \
                warn "Failed to update to main"
        else
            (cd "$ACCORD_DIR" && git checkout --quiet "$REQUESTED_VERSION" 2>/dev/null) || \
                err "Version $REQUESTED_VERSION not found. Available versions: $(cd "$ACCORD_DIR" && git tag --sort=-v:refname 'v*' | head -5 | tr '\n' ' ')"
        fi

        NEW_VERSION="$(get_version "$ACCORD_DIR")"

        if [[ "$CURRENT_VERSION" != "$NEW_VERSION" ]]; then
            log "Updated: v${CURRENT_VERSION} → v${NEW_VERSION}"
        else
            log "Already at latest: v${CURRENT_VERSION}"
        fi
        CURRENT_VERSION="$NEW_VERSION"
    fi
else
    warn "$ACCORD_DIR is not a git repository — skipping framework update"
    log "Using Accord v${CURRENT_VERSION}"
fi

echo ""

# ── Step 2: Read project config ──────────────────────────────────────────────

CONFIG_FILE="$TARGET_DIR/.accord/config.yaml"

if [[ ! -f "$CONFIG_FILE" ]]; then
    err "No Accord config found at $CONFIG_FILE — is this an Accord project?"
fi

# Parse config values
PROJECT_NAME="$(sed -n 's/^  name: //p' "$CONFIG_FILE" | head -1)"
SYNC_MODE="$(sed -n 's/^  sync_mode: //p' "$CONFIG_FILE" | head -1)"
SYNC_MODE="${SYNC_MODE:-on-action}"

# Parse services
SERVICES="$(sed -n 's/^  - name: //p' "$CONFIG_FILE" | tr '\n' ',' | sed 's/,$//')"

# Detect adapter from existing files
ADAPTER="none"
if [[ -f "$TARGET_DIR/CLAUDE.md" ]] && grep -q "<!-- ACCORD START" "$TARGET_DIR/CLAUDE.md"; then
    ADAPTER="claude-code"
elif [[ -f "$TARGET_DIR/.accord/adapter/AGENT_INSTRUCTIONS.md" ]]; then
    ADAPTER="generic"
fi

# Detect modules from config (flat list: entries with "type: module")
MODULES=""
SERVICE=""
MODULES="$(sed -n '/type: module/{ x; s/^[[:space:]]*- name: //p; d; }; h' "$CONFIG_FILE" | tr '\n' ',' | sed 's/,$//')"

# Detect language from config (from module entries)
LANGUAGE="java"
detected_lang="$(sed -n 's/^[[:space:]]*language: //p' "$CONFIG_FILE" | head -1)"
if [[ -n "$detected_lang" ]]; then
    LANGUAGE="$detected_lang"
fi

# ── Display current state ───────────────────────────────────────────────────

echo -e "  Project:       ${GREEN}$PROJECT_NAME${NC}"
echo -e "  Services:      ${GREEN}$SERVICES${NC}"
[[ -n "$MODULES" ]] && echo -e "  Modules:       ${GREEN}$MODULES${NC}"
echo -e "  Adapter:       ${GREEN}$ADAPTER${NC}"
echo -e "  Sync mode:     ${GREEN}$SYNC_MODE${NC}"
echo -e "  Accord:        ${GREEN}v${CURRENT_VERSION}${NC}"
echo ""

UPDATED=0

# ── Upgrade protocol reference ───────────────────────────────────────────────

upgrade_protocol_files() {
    # .accord/comms/TEMPLATE.md — update from template
    local template_file="$TARGET_DIR/.accord/comms/TEMPLATE.md"
    local src_template="$ACCORD_DIR/protocol/templates/request.md.template"
    if [[ -f "$template_file" && -f "$src_template" ]]; then
        if ! diff -q "$template_file" "$src_template" >/dev/null 2>&1; then
            cp "$src_template" "$template_file"
            log "Upgraded .accord/comms/TEMPLATE.md"
            UPDATED=$((UPDATED + 1))
        else
            log ".accord/comms/TEMPLATE.md — already up to date"
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

    local internal_dir=""
    [[ -n "$MODULES" ]] && internal_dir=".accord/contracts/internal/"

    log "Upgrading Claude Code adapter (CLAUDE.md + commands + skills)..."

    bash "$install_script" \
        --project-dir "$TARGET_DIR" \
        --project-name "$PROJECT_NAME" \
        --service-list "$SERVICES" \
        --contracts-dir ".accord/contracts/" \
        --comms-dir ".accord/comms/" \
        --sync-mode "$SYNC_MODE" \
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

    replace_vars "$dest" \
        "PROJECT_NAME" "$PROJECT_NAME" \
        "SERVICE_LIST" "$SERVICES" \
        "CONTRACTS_DIR" ".accord/contracts/" \
        "INTERNAL_CONTRACTS_DIR" ".accord/contracts/internal/" \
        "COMMS_DIR" ".accord/comms/"

    log "Upgraded generic adapter instructions"
    UPDATED=$((UPDATED + 1))
}

# ── Upgrade watch script ────────────────────────────────────────────────────

upgrade_watch_script() {
    local watch_file="$TARGET_DIR/.accord/accord-watch.sh"

    if [[ "$SYNC_MODE" == "auto-poll" ]]; then
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
COMMS_DIR=".accord/comms"

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
        rm -f "$watch_file"
        log "Removed .accord/accord-watch.sh (sync mode changed to $SYNC_MODE)"
        UPDATED=$((UPDATED + 1))
    fi
}

# ── Upgrade debug viewer ───────────────────────────────────────────────────

upgrade_debug_viewer() {
    local viewer_src="$ACCORD_DIR/protocol/debug/viewer.html"
    local log_dir="$TARGET_DIR/.accord/log"

    # Ensure log directory and .gitignore exist
    if [[ ! -d "$log_dir" ]]; then
        mkdir -p "$log_dir"
        log "Created .accord/log/"
    fi
    if [[ ! -f "$log_dir/.gitignore" ]]; then
        echo "*.jsonl" > "$log_dir/.gitignore"
        log "Created .accord/log/.gitignore"
    fi

    # Copy viewer if source exists
    if [[ -f "$viewer_src" ]]; then
        if [[ ! -f "$log_dir/index.html" ]] || ! diff -q "$viewer_src" "$log_dir/index.html" >/dev/null 2>&1; then
            cp "$viewer_src" "$log_dir/index.html"
            log "Upgraded .accord/log/index.html (debug viewer)"
            UPDATED=$((UPDATED + 1))
        else
            log ".accord/log/index.html — already up to date"
        fi
    fi

    # Ensure debug setting exists in config
    if [[ -f "$TARGET_DIR/.accord/config.yaml" ]] && ! grep -q "debug:" "$TARGET_DIR/.accord/config.yaml"; then
        echo "  debug: false" >> "$TARGET_DIR/.accord/config.yaml"
        log "Added debug: false to config.yaml"
        UPDATED=$((UPDATED + 1))
    fi
}

# ── Rebuild TypeScript agent ─────────────────────────────────────────────────

upgrade_ts_agent() {
    if ! command -v node >/dev/null 2>&1; then return; fi

    local node_ver
    node_ver="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
    if [[ -z "$node_ver" || "$node_ver" -lt 20 ]]; then return; fi

    if [[ ! -f "$ACCORD_DIR/agent/package.json" ]]; then return; fi

    log "Rebuilding TypeScript agent..."
    if (cd "$ACCORD_DIR/agent" && npm install --quiet 2>/dev/null && npm run build 2>/dev/null); then
        log "TypeScript agent rebuilt"
        UPDATED=$((UPDATED + 1))
    else
        warn "TypeScript agent rebuild failed — legacy bash agent will be used"
    fi
}

# ── Execute ──────────────────────────────────────────────────────────────────

upgrade_protocol_files
upgrade_claude_code
upgrade_generic
upgrade_watch_script
upgrade_debug_viewer
upgrade_ts_agent

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
if [[ "$UPDATED" -gt 0 ]]; then
    echo -e "${BOLD}=== Upgrade complete ===${NC} (v${CURRENT_VERSION}, $UPDATED items updated)"
else
    echo -e "${BOLD}=== Already up to date ===${NC} (v${CURRENT_VERSION})"
fi
echo ""
echo -e "  ${DIM}Unchanged: .accord/config.yaml, .accord/contracts/, inbox data${NC}"
echo ""
