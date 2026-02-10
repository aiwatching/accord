#!/usr/bin/env bash
# Accord Project Initialization Script
# Scaffolds directory structure, config files, and adapter installation.
#
# Usage:
#   cd your-project && ~/.accord/init.sh        # Interactive (auto-detects everything)
#   ~/.accord/init.sh --no-interactive           # Use auto-detected defaults without prompts
#
# See --help for all options.

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────

PROJECT_NAME=""
REPO_MODEL="monorepo"
TEAMS=""
ADAPTER=""
SERVICE=""
MODULES=""
HUB=""
LANGUAGE="java"
TARGET_DIR="."
INTERACTIVE=true
SCAN=false
SYNC_MODE=""

# ── Helpers ───────────────────────────────────────────────────────────────────

usage() {
    cat <<'HELP'
Usage: init.sh [options]

Run in your project directory. Auto-detects project name, client, teams, and modules.

Options:
  --project-name <name>       Override auto-detected project name
  --teams <csv>               Override auto-detected team names
  --adapter <name>            Override auto-detected client (claude-code|cursor|codex|generic|none)
  --sync-mode <mode>          on-action | auto-poll | manual (default: on-action)
  --service <name>            Team directory that has sub-modules (auto-detects modules)
  --modules <csv>             Explicit module names (overrides auto-detection)
  --repo-model <model>        monorepo | multi-repo (default: monorepo)
  --hub <git-url>             Hub repo URL (multi-repo only)
  --language <lang>           java | python | typescript | go (default: java)
  --scan                      After scaffolding, run contract scan
  --target-dir <path>         Target directory (default: current directory)
  --no-interactive            Use auto-detected defaults without prompts
  --help                      Show this help message

Examples:
  # Auto-detect everything (recommended)
  cd your-project && ~/.accord/init.sh

  # Non-interactive with all auto-detection
  ~/.accord/init.sh --no-interactive

  # Override specific values
  ~/.accord/init.sh --teams "frontend,backend,engine" --sync-mode auto-poll
HELP
}

log() { echo "[accord] $*"; }
warn() { echo "[accord] WARNING: $*" >&2; }
err() { echo "[accord] ERROR: $*" >&2; exit 1; }

GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# Portable sed in-place: avoids macOS vs Linux -i differences
sed_inplace() {
    local expression="$1"
    local file="$2"
    local tmp="${file}.accord_tmp"
    sed "$expression" "$file" > "$tmp" && mv "$tmp" "$file"
}

# Replace {{VAR}} placeholders in a file
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

# ── Auto-Detection ──────────────────────────────────────────────────────────

# List subdirectories, excluding hidden/build/tool dirs
list_subdirs() {
    local dir="$1"
    local results=""
    for d in "$dir"/*/; do
        [[ ! -d "$d" ]] && continue
        local name
        name="$(basename "$d")"
        case "$name" in
            .*|node_modules|build|dist|target|out|__pycache__|\
.accord|.agent-comms|.git|.idea|.vscode|.cursor|.claude|\
contracts|docs|examples|protocol|adapters|vendor|venv|env) continue ;;
        esac
        if [[ -n "$results" ]]; then
            results="$results,$name"
        else
            results="$name"
        fi
    done
    echo "$results"
}

# Detect project name from IDE/build files or directory name
detect_project_name() {
    local dir="$1"

    # package.json
    if [[ -f "$dir/package.json" ]]; then
        local name
        name="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$dir/package.json" | head -1)"
        if [[ -n "$name" && "$name" != "."* ]]; then
            echo "$name"; return
        fi
    fi

    # settings.gradle / settings.gradle.kts
    for gf in "$dir/settings.gradle" "$dir/settings.gradle.kts"; do
        if [[ -f "$gf" ]]; then
            local name
            name="$(sed -n "s/.*rootProject\.name[[:space:]]*=[[:space:]]*['\"\`]\([^'\"\`]*\)['\"\`].*/\1/p" "$gf" | head -1)"
            if [[ -n "$name" ]]; then
                echo "$name"; return
            fi
        fi
    done

    # pom.xml (top-level artifactId)
    if [[ -f "$dir/pom.xml" ]]; then
        local name
        name="$(sed -n '/<parent>/,/<\/parent>/d; s/.*<artifactId>\([^<]*\)<\/artifactId>.*/\1/p' "$dir/pom.xml" | head -1)"
        if [[ -n "$name" ]]; then
            echo "$name"; return
        fi
    fi

    # pyproject.toml
    if [[ -f "$dir/pyproject.toml" ]]; then
        local name
        name="$(sed -n 's/^name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$dir/pyproject.toml" | head -1)"
        if [[ -n "$name" ]]; then
            echo "$name"; return
        fi
    fi

    # .idea/.name (IntelliJ)
    if [[ -f "$dir/.idea/.name" ]]; then
        local name
        name="$(head -1 "$dir/.idea/.name" | tr -d '[:space:]')"
        if [[ -n "$name" ]]; then
            echo "$name"; return
        fi
    fi

    # Fallback: directory name
    basename "$(cd "$dir" && pwd)"
}

# Detect AI client from project config directories
detect_adapter() {
    local dir="$1"

    if [[ -d "$dir/.claude" || -f "$dir/CLAUDE.md" ]]; then
        echo "claude-code"; return
    fi
    if [[ -d "$dir/.cursor" || -f "$dir/.cursorrules" ]]; then
        echo "cursor"; return
    fi
    if [[ -f "$dir/AGENTS.md" ]]; then
        echo "codex"; return
    fi

    echo "none"
}

# Detect language from project files
detect_language() {
    local dir="$1"

    if [[ -f "$dir/pom.xml" || -f "$dir/build.gradle" || -f "$dir/build.gradle.kts" ]]; then
        echo "java"; return
    fi
    if [[ -f "$dir/pyproject.toml" || -f "$dir/setup.py" || -f "$dir/requirements.txt" ]]; then
        echo "python"; return
    fi
    if [[ -f "$dir/tsconfig.json" ]]; then
        echo "typescript"; return
    fi
    if [[ -f "$dir/go.mod" ]]; then
        echo "go"; return
    fi
    if [[ -f "$dir/package.json" ]]; then
        echo "typescript"; return
    fi

    echo "java"
}

# ── Argument Parsing ─────────────────────────────────────────────────────────

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --project-name)   PROJECT_NAME="$2"; shift 2 ;;
            --repo-model)     REPO_MODEL="$2"; shift 2 ;;
            --teams)          TEAMS="$2"; shift 2 ;;
            --adapter)        ADAPTER="$2"; shift 2 ;;
            --sync-mode)      SYNC_MODE="$2"; shift 2 ;;
            --service)        SERVICE="$2"; shift 2 ;;
            --modules)        MODULES="$2"; shift 2 ;;
            --hub)            HUB="$2"; shift 2 ;;
            --language)       LANGUAGE="$2"; shift 2 ;;
            --target-dir)     TARGET_DIR="$2"; shift 2 ;;
            --scan)           SCAN=true; shift ;;
            --no-interactive) INTERACTIVE=false; shift ;;
            --help)           usage; exit 0 ;;
            *)                err "Unknown option: $1. Use --help for usage." ;;
        esac
    done
}

# ── Interactive Prompts ──────────────────────────────────────────────────────

interactive_prompt() {
    local abs_target
    abs_target="$(cd "$TARGET_DIR" && pwd)"

    echo ""
    echo -e "${BOLD}=== Accord Project Initialization ===${NC}"
    echo ""

    # ── Auto-detect and display ──────────────────────────────────────────

    local detected_name
    detected_name="$(detect_project_name "$abs_target")"

    local detected_adapter
    if [[ -z "$ADAPTER" ]]; then
        detected_adapter="$(detect_adapter "$abs_target")"
    else
        detected_adapter="$ADAPTER"
    fi

    local detected_lang
    detected_lang="$(detect_language "$abs_target")"
    LANGUAGE="$detected_lang"

    local detected_teams
    detected_teams="$(list_subdirs "$abs_target")"

    # ── Show what we found ───────────────────────────────────────────────

    echo -e "  ${DIM}Scanning project directory...${NC}"
    echo ""
    echo -e "  Project name:  ${GREEN}${detected_name}${NC}"
    [[ "$detected_adapter" != "none" ]] && \
        echo -e "  Client:        ${GREEN}${detected_adapter}${NC} ${DIM}(detected)${NC}"
    echo -e "  Language:      ${GREEN}${detected_lang}${NC}"
    if [[ -n "$detected_teams" ]]; then
        echo -e "  Directories:   ${GREEN}${detected_teams}${NC}"
    fi
    echo ""

    # ── Confirm project name ─────────────────────────────────────────────

    if [[ -z "$PROJECT_NAME" ]]; then
        read -r -p "  Project name [$detected_name]: " input
        PROJECT_NAME="${input:-$detected_name}"
    fi

    # ── Confirm teams ────────────────────────────────────────────────────

    if [[ -z "$TEAMS" ]]; then
        if [[ -n "$detected_teams" ]]; then
            read -r -p "  Teams (edit or Enter to confirm) [$detected_teams]: " input
            TEAMS="${input:-$detected_teams}"
        else
            read -r -p "  Team names (comma-separated): " TEAMS
        fi
    fi

    [[ -z "$TEAMS" ]] && err "At least one team is required"

    # ── Detect modules in each team directory ────────────────────────────

    if [[ -z "$SERVICE" ]]; then
        IFS=',' read -ra _teams <<< "$TEAMS"
        for _team in "${_teams[@]}"; do
            _team="$(echo "$_team" | xargs)"
            local team_dir="$abs_target/$_team"
            if [[ -d "$team_dir" ]]; then
                local detected_mods
                detected_mods="$(list_subdirs "$team_dir")"
                if [[ -n "$detected_mods" ]]; then
                    echo ""
                    echo -e "  ${CYAN}$_team/${NC} has sub-modules: ${GREEN}$detected_mods${NC}"
                    read -r -p "  Use these as modules? (y/n/edit) [y]: " confirm
                    confirm="${confirm:-y}"
                    if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
                        SERVICE="$_team"
                        MODULES="$detected_mods"
                    elif [[ "$confirm" != "n" && "$confirm" != "N" ]]; then
                        SERVICE="$_team"
                        MODULES="$confirm"
                    fi
                    [[ -n "$SERVICE" ]] && break
                fi
            fi
        done
    fi

    # If --service was passed but no modules, auto-detect
    if [[ -n "$SERVICE" && -z "$MODULES" ]]; then
        local svc_dir="$abs_target/$SERVICE"
        if [[ -d "$svc_dir" ]]; then
            MODULES="$(list_subdirs "$svc_dir")"
            if [[ -n "$MODULES" ]]; then
                echo -e "  Auto-detected modules in $SERVICE/: ${GREEN}$MODULES${NC}"
            else
                read -r -p "  No subdirectories found in $SERVICE/. Module names (comma-separated, empty to skip): " MODULES
            fi
        fi
    fi

    # ── Confirm adapter ──────────────────────────────────────────────────

    if [[ -z "$ADAPTER" ]]; then
        if [[ "$detected_adapter" != "none" ]]; then
            read -r -p "  Adapter [$detected_adapter]: " input
            ADAPTER="${input:-$detected_adapter}"
        else
            read -r -p "  Adapter (claude-code/cursor/codex/generic/none) [none]: " input
            ADAPTER="${input:-none}"
        fi
    fi

    # ── Sync mode ────────────────────────────────────────────────────────

    if [[ -z "$SYNC_MODE" ]]; then
        echo ""
        echo "  Sync mode — how agents check for incoming requests:"
        echo -e "    ${BOLD}1${NC}. on-action   — agent auto-checks before/after operations ${DIM}(recommended)${NC}"
        echo -e "    ${BOLD}2${NC}. auto-poll   — background script pulls every 5 minutes"
        echo -e "    ${BOLD}3${NC}. manual      — you run /check-inbox explicitly"
        read -r -p "  Choice [1]: " sync_choice
        case "${sync_choice:-1}" in
            1|on-action)  SYNC_MODE="on-action" ;;
            2|auto-poll)  SYNC_MODE="auto-poll" ;;
            3|manual)     SYNC_MODE="manual" ;;
            *)            SYNC_MODE="on-action" ;;
        esac
    fi

    # ── Scan ─────────────────────────────────────────────────────────────

    if [[ "$SCAN" == false ]]; then
        read -r -p "  Auto-scan source code for contracts? (y/n) [n]: " scan_input
        [[ "$scan_input" == "y" || "$scan_input" == "Y" ]] && SCAN=true
    fi
}

# ── Validation ───────────────────────────────────────────────────────────────

validate_inputs() {
    [[ -z "$PROJECT_NAME" ]] && err "Project name is required (--project-name or auto-detect)"
    [[ -z "$TEAMS" ]] && err "At least one team is required (--teams or auto-detect)"

    [[ "$REPO_MODEL" != "monorepo" && "$REPO_MODEL" != "multi-repo" ]] && \
        err "Invalid repo model: $REPO_MODEL (must be monorepo or multi-repo)"

    if [[ "$REPO_MODEL" == "multi-repo" && -z "$HUB" ]]; then
        err "Hub repo URL is required for multi-repo model (--hub)"
    fi

    if [[ -n "$MODULES" && -z "$SERVICE" ]]; then
        err "Service name is required when modules are specified (--service)"
    fi

    # Auto-detect modules from directory if --service given without --modules
    if [[ -n "$SERVICE" && -z "$MODULES" ]]; then
        local svc_dir="$TARGET_DIR/$SERVICE"
        if [[ -d "$svc_dir" ]]; then
            MODULES="$(list_subdirs "$svc_dir")"
            [[ -n "$MODULES" ]] && log "Auto-detected modules in $SERVICE/: $MODULES"
        fi
    fi

    # Defaults
    SYNC_MODE="${SYNC_MODE:-on-action}"
    ADAPTER="${ADAPTER:-none}"

    case "$LANGUAGE" in
        java|python|typescript|go) ;;
        *) err "Invalid language: $LANGUAGE (must be java, python, typescript, or go)" ;;
    esac

    case "$ADAPTER" in
        claude-code|cursor|codex|generic|none) ;;
        *) err "Invalid adapter: $ADAPTER (must be claude-code, cursor, codex, generic, or none)" ;;
    esac

    case "$SYNC_MODE" in
        on-action|auto-poll|manual) ;;
        *) err "Invalid sync mode: $SYNC_MODE (must be on-action, auto-poll, or manual)" ;;
    esac
}

# ── Config Generation ────────────────────────────────────────────────────────

generate_project_config() {
    local config_file="$TARGET_DIR/.accord/config.yaml"

    if [[ -f "$config_file" ]]; then
        warn "Config already exists: $config_file (skipping)"
        return
    fi

    mkdir -p "$TARGET_DIR/.accord"

    local hub_line=""
    if [[ "$REPO_MODEL" == "multi-repo" && -n "$HUB" ]]; then
        hub_line=$'\n'"hub: $HUB"
    fi

    # Build teams section
    local teams_yaml=""
    IFS=',' read -ra team_arr <<< "$TEAMS"
    for team in "${team_arr[@]}"; do
        team="$(echo "$team" | xargs)"  # trim whitespace
        teams_yaml="${teams_yaml}
  - name: ${team}
    contracts:
      external: contracts/${team}.yaml"
    done

    cat > "$config_file" <<EOF
version: "0.1"
project:
  name: ${PROJECT_NAME}

repo_model: ${REPO_MODEL}${hub_line}

teams:${teams_yaml}

settings:
  sync_mode: ${SYNC_MODE}
  auto_pull_on_start: true
  require_human_approval: true
  archive_completed: true
EOF

    log "Created $config_file"
}

generate_service_config() {
    [[ -z "$SERVICE" || -z "$MODULES" ]] && return

    local config_file="$TARGET_DIR/$SERVICE/.accord/config.yaml"

    if [[ -f "$config_file" ]]; then
        warn "Service config already exists: $config_file (skipping)"
        return
    fi

    mkdir -p "$TARGET_DIR/$SERVICE/.accord"

    # Build modules section
    local modules_yaml=""
    IFS=',' read -ra mod_arr <<< "$MODULES"
    for mod in "${mod_arr[@]}"; do
        mod="$(echo "$mod" | xargs)"
        modules_yaml="${modules_yaml}
  - name: ${mod}
    path: ${mod}/
    contract: ${mod}/.accord/contract.md
    type: ${LANGUAGE}-interface"
    done

    cat > "$config_file" <<EOF
version: "0.1"
service:
  name: ${SERVICE}

modules:${modules_yaml}

settings:
  auto_collect_on_sync: true
EOF

    log "Created $config_file"
}

# ── Directory Scaffolding ────────────────────────────────────────────────────

scaffold_project() {
    log "Scaffolding project: $PROJECT_NAME"

    # contracts/
    mkdir -p "$TARGET_DIR/contracts"
    IFS=',' read -ra team_arr <<< "$TEAMS"
    for team in "${team_arr[@]}"; do
        team="$(echo "$team" | xargs)"
        local contract_file="$TARGET_DIR/contracts/${team}.yaml"
        if [[ ! -f "$contract_file" ]]; then
            cp "$ACCORD_DIR/protocol/templates/contract.yaml.template" "$contract_file"
            replace_vars "$contract_file" \
                "TEAM_NAME" "$team" \
                "SCANNED_TIMESTAMP" "" \
                "RESOURCE" "example" \
                "RESOURCE_PASCAL" "Example"
            log "Created $contract_file (template — edit to match your API)"
        fi
    done

    # .agent-comms/
    mkdir -p "$TARGET_DIR/.agent-comms/archive"
    for team in "${team_arr[@]}"; do
        team="$(echo "$team" | xargs)"
        mkdir -p "$TARGET_DIR/.agent-comms/inbox/${team}"
        touch "$TARGET_DIR/.agent-comms/inbox/${team}/.gitkeep"
    done

    # .agent-comms/PROTOCOL.md
    generate_comms_protocol "$TARGET_DIR/.agent-comms/PROTOCOL.md"

    # .agent-comms/TEMPLATE.md
    if [[ ! -f "$TARGET_DIR/.agent-comms/TEMPLATE.md" ]]; then
        cp "$ACCORD_DIR/protocol/templates/request.md.template" "$TARGET_DIR/.agent-comms/TEMPLATE.md"
        log "Created .agent-comms/TEMPLATE.md"
    fi

    # Project config
    generate_project_config
}

scaffold_service() {
    [[ -z "$SERVICE" || -z "$MODULES" ]] && return

    log "Scaffolding service: $SERVICE (modules: $MODULES)"

    local svc_dir="$TARGET_DIR/$SERVICE"
    mkdir -p "$svc_dir/.accord/internal-contracts"
    mkdir -p "$svc_dir/.agent-comms/archive"

    IFS=',' read -ra mod_arr <<< "$MODULES"
    for mod in "${mod_arr[@]}"; do
        mod="$(echo "$mod" | xargs)"

        # Module inbox
        mkdir -p "$svc_dir/.agent-comms/inbox/${mod}"
        touch "$svc_dir/.agent-comms/inbox/${mod}/.gitkeep"

        # Module contract directory
        mkdir -p "$svc_dir/${mod}/.accord"

        # Internal contract from template
        local contract_file="$svc_dir/${mod}/.accord/contract.md"
        if [[ ! -f "$contract_file" ]]; then
            cp "$ACCORD_DIR/protocol/templates/internal-contract.md.template" "$contract_file"
            replace_vars "$contract_file" \
                "MODULE_NAME" "$mod" \
                "LANGUAGE" "$LANGUAGE"
            log "Created $contract_file (template — edit to match your module interface)"
        fi

        # Collected copy placeholder
        local collected_file="$svc_dir/.accord/internal-contracts/${mod}.md"
        if [[ ! -f "$collected_file" ]]; then
            cp "$contract_file" "$collected_file"
            log "Created $collected_file (collected copy)"
        fi
    done

    # Service config
    generate_service_config
}

# ── Comms Protocol ───────────────────────────────────────────────────────────

generate_comms_protocol() {
    local output_file="$1"

    if [[ -f "$output_file" ]]; then
        warn "PROTOCOL.md already exists: $output_file (skipping)"
        return
    fi

    cat > "$output_file" <<'PROTO'
# Accord Protocol (In-Project Reference)

Condensed protocol rules for participating agents. Full specification: see the Accord repository's `PROTOCOL.md`.

## Directory Layout

- `contracts/{team}.yaml` — External contracts (OpenAPI). One per team. Only the owning team edits.
- `.agent-comms/inbox/{team}/` — Incoming requests for a team.
- `.agent-comms/archive/` — Completed/rejected requests.
- `{service}/.accord/internal-contracts/{module}.md` — Collected internal contracts.
- `{service}/{module}/.accord/contract.md` — Module contract source of truth.

## Request Format

Markdown with YAML frontmatter. Required fields: `id`, `from`, `to`, `scope`, `type`, `priority`, `status`, `created`, `updated`. See `TEMPLATE.md` for the full template.

## State Machine

```
pending → approved → in-progress → completed
pending → rejected
```

- `pending → approved`: Requires human review.
- `approved → in-progress`: Agent starts implementation.
- `in-progress → completed`: Contract updated, request archived.
- Rejected requests are archived with a `## Rejection Reason` section.

## Request Types

**External**: `api-addition`, `api-change`, `api-deprecation`
**Internal**: `interface-addition`, `interface-change`, `interface-deprecation`
**Shared**: `bug-report`, `question`, `other`

## Git Operations

**Sending a request**:
1. Create request file in `.agent-comms/inbox/{target}/`
2. Optionally annotate `contracts/{target}.yaml` with `x-accord-status: proposed`
3. Commit: `comms({target}): request - {summary}`
4. Push

**Completing a request**:
1. Implement the change
2. Update the contract (remove `x-accord-status` annotation)
3. Set request status to `completed`
4. Move request to `.agent-comms/archive/`
5. Commit: `comms({own-team}): completed - {request-id}`
6. Push

## Rules

1. Never modify another team's contract directly — use a request.
2. Never auto-approve requests — human review is required.
3. A request cannot be `completed` unless the contract is updated.
4. Check your inbox on every session start (`git pull` first).
5. Use mock data / TODO markers while waiting for pending requests.

## Commit Convention

```
comms({team}): {action} - {summary}
contract({team}): {action} - {summary}
```

Actions: `request`, `approved`, `rejected`, `in-progress`, `completed`, `update`
PROTO

    log "Created $output_file"
}

# ── Watch Script (auto-poll sync mode) ──────────────────────────────────────

generate_watch_script() {
    [[ "$SYNC_MODE" != "auto-poll" ]] && return

    local watch_file="$TARGET_DIR/.accord/accord-watch.sh"

    if [[ -f "$watch_file" ]]; then
        warn "Watch script already exists: $watch_file (skipping)"
        return
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
    log "Created $watch_file (run with: .accord/accord-watch.sh &)"
}

# ── Adapter Installation ─────────────────────────────────────────────────────

install_adapter() {
    [[ "$ADAPTER" == "none" ]] && return

    local adapter_dir="$ACCORD_DIR/adapters/$ADAPTER"

    if [[ ! -d "$adapter_dir" ]]; then
        warn "Adapter directory not found: $adapter_dir"
        return
    fi

    local install_script="$adapter_dir/install.sh"
    if [[ -f "$install_script" ]]; then
        log "Installing adapter: $ADAPTER"

        local team_name="${SERVICE:-$(echo "$TEAMS" | cut -d',' -f1 | xargs)}"
        local modules_arg=""
        [[ -n "$MODULES" ]] && modules_arg="--module-list $MODULES"

        local internal_dir=""
        [[ -n "$SERVICE" ]] && internal_dir="$SERVICE/.accord/internal-contracts/"

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

        log "Adapter $ADAPTER installed"
    else
        # Generic adapter or adapters without install.sh — copy the instructions file
        local instructions="$adapter_dir/AGENT_INSTRUCTIONS.md"
        if [[ -f "$instructions" ]]; then
            local dest="$TARGET_DIR/.accord/adapter/AGENT_INSTRUCTIONS.md"
            mkdir -p "$TARGET_DIR/.accord/adapter"
            cp "$instructions" "$dest"
            replace_vars "$dest" \
                "PROJECT_NAME" "$PROJECT_NAME" \
                "TEAM_NAME" "${SERVICE:-$(echo "$TEAMS" | cut -d',' -f1 | xargs)}" \
                "TEAM_LIST" "$TEAMS" \
                "MODULE_LIST" "${MODULES:-}" \
                "CONTRACTS_DIR" "contracts/" \
                "INTERNAL_CONTRACTS_DIR" "${SERVICE:+$SERVICE/.accord/internal-contracts/}" \
                "COMMS_DIR" ".agent-comms/"
            log "Copied adapter instructions to $dest"
        else
            warn "No install.sh or AGENT_INSTRUCTIONS.md found for adapter: $ADAPTER"
        fi
    fi
}

# ── Contract Scanning ─────────────────────────────────────────────────────────

run_scan() {
    [[ "$SCAN" == false ]] && return

    local scan_script="$ACCORD_DIR/protocol/scan/scan.sh"
    if [[ ! -f "$scan_script" ]]; then
        warn "Scan script not found: $scan_script (skipping scan)"
        return
    fi

    echo ""
    log "=== Contract Scan ==="
    log ""

    # Scan each team as a service
    IFS=',' read -ra team_arr <<< "$TEAMS"
    for team in "${team_arr[@]}"; do
        team="$(echo "$team" | xargs)"
        local team_dir="$TARGET_DIR/$team"

        # Only scan if the team directory has source code
        if [[ -d "$team_dir" ]]; then
            log "Scanning service: $team"
            (cd "$TARGET_DIR" && bash "$scan_script" --service "$team" --type all 2>&1) || true
            echo ""
        fi
    done

    # If a service has modules, scan internal contracts
    if [[ -n "$SERVICE" && -n "$MODULES" ]]; then
        local svc_dir="$TARGET_DIR/$SERVICE"
        if [[ -d "$svc_dir" ]]; then
            log "Scanning service with modules: $SERVICE"
            (cd "$TARGET_DIR" && bash "$scan_script" --service "$SERVICE" --type internal 2>&1) || true
            echo ""
        fi
    fi

    # Validate any existing contracts
    log "Validating existing contracts..."
    local has_contracts=false
    for f in "$TARGET_DIR/contracts"/*.yaml; do
        [[ -f "$f" ]] || continue
        has_contracts=true
        echo -n "  $f ... "
        if bash "$ACCORD_DIR/protocol/scan/validators/validate-openapi.sh" "$f" 2>/dev/null; then
            echo "PASS"
        else
            echo "FAIL"
        fi
    done

    if [[ -n "$SERVICE" ]]; then
        for f in "$TARGET_DIR/$SERVICE/.accord/internal-contracts"/*.md; do
            [[ -f "$f" ]] || continue
            has_contracts=true
            echo -n "  $f ... "
            if bash "$ACCORD_DIR/protocol/scan/validators/validate-internal.sh" "$f" 2>/dev/null; then
                echo "PASS"
            else
                echo "FAIL"
            fi
        done
    fi

    [[ "$has_contracts" == false ]] && log "No source code directories found to scan — contracts contain templates."
    log ""
    log "If you are running inside an AI agent, the agent should now follow the scan prompts above"
    log "to analyze your source code and generate real contracts."
}

# ── Summary ──────────────────────────────────────────────────────────────────

print_summary() {
    echo ""
    echo -e "${BOLD}=== Accord initialization complete ===${NC}"
    echo ""
    echo -e "  Project:    ${GREEN}$PROJECT_NAME${NC}"
    echo -e "  Teams:      ${GREEN}$TEAMS${NC}"
    [[ -n "$SERVICE" ]] && echo -e "  Modules:    ${GREEN}$SERVICE/ → $MODULES${NC}"
    [[ "$ADAPTER" != "none" ]] && echo -e "  Adapter:    ${GREEN}$ADAPTER${NC}"
    echo -e "  Sync mode:  ${GREEN}$SYNC_MODE${NC}"
    echo ""
    echo "  Created structure:"
    echo "    .accord/config.yaml          — Project configuration"
    echo "    contracts/                    — External contracts (one per team)"
    echo "    .agent-comms/inbox/{team}/   — Team inboxes"
    echo "    .agent-comms/PROTOCOL.md     — Protocol reference"
    if [[ -n "$SERVICE" ]]; then
        echo "    $SERVICE/.accord/            — Service config + internal contracts"
        echo "    $SERVICE/.agent-comms/       — Module communication"
    fi
    if [[ "$SYNC_MODE" == "auto-poll" ]]; then
        echo "    .accord/accord-watch.sh      — Background polling script"
    fi
    echo ""
    echo "  Next steps:"
    if [[ "$SCAN" == true ]]; then
        echo "    1. Review generated contracts (status: draft) and change to 'stable'"
    else
        echo "    1. Edit contracts in contracts/ to match your actual APIs"
    fi
    echo "    2. git add -A && git commit -m 'accord: init project'"
    echo "    3. Start your agent — it will check the inbox on start"
    if [[ "$SYNC_MODE" == "auto-poll" ]]; then
        echo "    4. Run: .accord/accord-watch.sh &"
    fi
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    parse_args "$@"

    # Auto-disable interactive mode when stdin is not a terminal (e.g., curl | bash)
    if [[ "$INTERACTIVE" == true ]] && ! tty -s 2>/dev/null; then
        INTERACTIVE=false
    fi

    # Resolve target directory early so auto-detection works
    TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

    # Non-interactive: apply auto-detection for missing values
    if [[ "$INTERACTIVE" == false ]]; then
        [[ -z "$PROJECT_NAME" ]] && PROJECT_NAME="$(detect_project_name "$TARGET_DIR")"
        [[ -z "$ADAPTER" ]] && ADAPTER="$(detect_adapter "$TARGET_DIR")"
        [[ -z "$TEAMS" ]] && TEAMS="$(list_subdirs "$TARGET_DIR")"
        LANGUAGE="$(detect_language "$TARGET_DIR")"

        # Auto-detect service with modules
        if [[ -z "$SERVICE" && -n "$TEAMS" ]]; then
            IFS=',' read -ra _teams <<< "$TEAMS"
            for _team in "${_teams[@]}"; do
                _team="$(echo "$_team" | xargs)"
                if [[ -d "$TARGET_DIR/$_team" ]]; then
                    local mods
                    mods="$(list_subdirs "$TARGET_DIR/$_team")"
                    if [[ -n "$mods" ]]; then
                        SERVICE="$_team"
                        MODULES="$mods"
                        break
                    fi
                fi
            done
        fi

        log "Auto-detected: project=$PROJECT_NAME teams=$TEAMS adapter=${ADAPTER:-none} lang=$LANGUAGE"
        [[ -n "$SERVICE" ]] && log "Auto-detected: service=$SERVICE modules=$MODULES"
    fi

    if [[ "$INTERACTIVE" == true ]]; then
        interactive_prompt
    fi

    validate_inputs

    scaffold_project
    scaffold_service
    generate_watch_script
    install_adapter
    run_scan
    print_summary
}

main "$@"
