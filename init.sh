#!/usr/bin/env bash
# Accord Project Initialization Script
# Scaffolds directory structure, config files, and adapter installation.
#
# Usage:
#   cd your-project && ~/.accord/init.sh        # Interactive (auto-detects everything)
#   ~/.accord/init.sh --no-interactive           # Use auto-detected defaults without prompts
#
# All Accord files are created under .accord/ — nothing scattered in the project root.
# Only client-specific files (CLAUDE.md, .claude/commands/) go where the client expects.

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────

PROJECT_NAME=""
REPO_MODEL="monorepo"
SERVICES=""
ADAPTER=""
SERVICE=""
MODULES=""
HUB=""
LANGUAGE="java"
TARGET_DIR="."
INTERACTIVE=true
SCAN=false
SYNC_MODE=""
HUB_SYNC_OK=false
FORCE=false
ROLE=""
INIT_SERVICES=false

# ── Helpers ───────────────────────────────────────────────────────────────────

usage() {
    cat <<'HELP'
Usage: init.sh [options]

Run in your project directory. Auto-detects project name, client, services, and modules.

Options:
  --project-name <name>       Override auto-detected project name
  --services <csv>             Override auto-detected service names
  --adapter <name>            Override auto-detected client (claude-code|cursor|codex|generic|none)
  --sync-mode <mode>          on-action | auto-poll | manual (default: on-action)
  --service <name>            Service directory that has sub-modules (auto-detects modules)
  --modules <csv>             Explicit module names (overrides auto-detection)
  --repo-model <model>        monorepo | multi-repo (default: monorepo)
  --hub <git-url>             Hub repo URL (multi-repo only)
  --language <lang>           java | python | typescript | go (default: java)
  --scan                      After scaffolding, run contract scan
  --target-dir <path>         Target directory (default: current directory)
  --role <role>               orchestrator | service (default: service)
  --init-services             Also init all service repos (orchestrator only, dirs must be siblings)
  --force                     Re-initialize even if .accord/config.yaml exists
  --no-interactive            Use auto-detected defaults without prompts
  --help                      Show this help message

Examples:
  # Auto-detect everything (recommended)
  cd your-project && ~/.accord/init.sh

  # Non-interactive with all auto-detection
  ~/.accord/init.sh --no-interactive

  # Override specific values
  ~/.accord/init.sh --services "frontend,backend,engine" --sync-mode auto-poll

  # Initialize as orchestrator hub (v2)
  ~/.accord/init.sh --role orchestrator --services "frontend,backend,engine" --adapter claude-code --target-dir ./hub

  # Initialize hub + all service repos in one command (service dirs must be siblings of hub)
  ~/.accord/init.sh --role orchestrator --services "svc-a,svc-b,svc-c" --adapter claude-code --init-services --hub git@github.com:org/hub.git
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

detect_project_name() {
    local dir="$1"
    if [[ -f "$dir/package.json" ]]; then
        local name
        name="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$dir/package.json" | head -1)"
        [[ -n "$name" && "$name" != "."* ]] && { echo "$name"; return; }
    fi
    for gf in "$dir/settings.gradle" "$dir/settings.gradle.kts"; do
        if [[ -f "$gf" ]]; then
            local name
            name="$(sed -n "s/.*rootProject\.name[[:space:]]*=[[:space:]]*['\"\`]\([^'\"\`]*\)['\"\`].*/\1/p" "$gf" | head -1)"
            [[ -n "$name" ]] && { echo "$name"; return; }
        fi
    done
    if [[ -f "$dir/pom.xml" ]]; then
        local name
        name="$(sed -n '/<parent>/,/<\/parent>/d; s/.*<artifactId>\([^<]*\)<\/artifactId>.*/\1/p' "$dir/pom.xml" | head -1)"
        [[ -n "$name" ]] && { echo "$name"; return; }
    fi
    if [[ -f "$dir/pyproject.toml" ]]; then
        local name
        name="$(sed -n 's/^name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$dir/pyproject.toml" | head -1)"
        [[ -n "$name" ]] && { echo "$name"; return; }
    fi
    if [[ -f "$dir/.idea/.name" ]]; then
        local name
        name="$(head -1 "$dir/.idea/.name" | tr -d '[:space:]')"
        [[ -n "$name" ]] && { echo "$name"; return; }
    fi
    basename "$(cd "$dir" && pwd)"
}

detect_adapter() {
    local dir="$1"
    [[ -d "$dir/.claude" || -f "$dir/CLAUDE.md" ]] && { echo "claude-code"; return; }
    [[ -d "$dir/.cursor" || -f "$dir/.cursorrules" ]] && { echo "cursor"; return; }
    [[ -f "$dir/AGENTS.md" ]] && { echo "codex"; return; }
    echo "none"
}

detect_language() {
    local dir="$1"
    [[ -f "$dir/pom.xml" || -f "$dir/build.gradle" || -f "$dir/build.gradle.kts" ]] && { echo "java"; return; }
    [[ -f "$dir/pyproject.toml" || -f "$dir/setup.py" || -f "$dir/requirements.txt" ]] && { echo "python"; return; }
    [[ -f "$dir/tsconfig.json" ]] && { echo "typescript"; return; }
    [[ -f "$dir/go.mod" ]] && { echo "go"; return; }
    [[ -f "$dir/package.json" ]] && { echo "typescript"; return; }
    echo "java"
}

# ── Argument Parsing ─────────────────────────────────────────────────────────

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --project-name)   PROJECT_NAME="$2"; shift 2 ;;
            --repo-model)     REPO_MODEL="$2"; shift 2 ;;
            --services)       SERVICES="$2"; shift 2 ;;
            --adapter)        ADAPTER="$2"; shift 2 ;;
            --sync-mode)      SYNC_MODE="$2"; shift 2 ;;
            --service)        SERVICE="$2"; shift 2 ;;
            --modules)        MODULES="$2"; shift 2 ;;
            --hub)            HUB="$2"; shift 2 ;;
            --language)       LANGUAGE="$2"; shift 2 ;;
            --target-dir)     TARGET_DIR="$2"; shift 2 ;;
            --role)            ROLE="$2"; shift 2 ;;
            --init-services)  INIT_SERVICES=true; shift ;;
            --scan)           SCAN=true; shift ;;
            --force)          FORCE=true; shift ;;
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

    local detected_services
    detected_services="$(list_subdirs "$abs_target")"

    echo -e "  ${DIM}Scanning project directory...${NC}"
    echo ""
    echo -e "  Project name:  ${GREEN}${detected_name}${NC}"
    [[ "$detected_adapter" != "none" ]] && \
        echo -e "  Client:        ${GREEN}${detected_adapter}${NC} ${DIM}(detected)${NC}"
    echo -e "  Language:      ${GREEN}${detected_lang}${NC}"
    [[ -n "$detected_services" ]] && \
        echo -e "  Directories:   ${GREEN}${detected_services}${NC}"
    echo ""

    if [[ -z "$PROJECT_NAME" ]]; then
        read -r -p "  Project name [$detected_name]: " input
        PROJECT_NAME="${input:-$detected_name}"
    fi

    if [[ "$REPO_MODEL" == "monorepo" && -z "$HUB" ]]; then
        echo ""
        echo "  Repo model — how your project is organized:"
        echo -e "    ${BOLD}1${NC}. monorepo    — all services in one repo ${DIM}(recommended)${NC}"
        echo -e "    ${BOLD}2${NC}. multi-repo  — each service in its own repo (hub-and-spoke)"
        read -r -p "  Choice [1]: " repo_choice
        case "${repo_choice:-1}" in
            2|multi-repo) REPO_MODEL="multi-repo" ;;
            *)            REPO_MODEL="monorepo" ;;
        esac

        if [[ "$REPO_MODEL" == "multi-repo" ]]; then
            read -r -p "  Hub repo URL (git URL for shared contracts): " HUB
            [[ -z "$HUB" ]] && err "Hub repo URL is required for multi-repo model"
        fi
    fi

    if [[ -z "$SERVICES" ]]; then
        if [[ -n "$detected_services" ]]; then
            read -r -p "  Services (edit or Enter to confirm) [$detected_services]: " input
            SERVICES="${input:-$detected_services}"
        else
            read -r -p "  Service names (comma-separated) [$PROJECT_NAME]: " input
            SERVICES="${input:-$PROJECT_NAME}"
        fi
    fi
    [[ -z "$SERVICES" ]] && err "At least one service is required"

    # Detect modules in service directories
    if [[ -z "$SERVICE" ]]; then
        IFS=',' read -ra _svcs <<< "$SERVICES"
        for _svc in "${_svcs[@]}"; do
            _svc="$(echo "$_svc" | xargs)"
            local svc_dir="$abs_target/$_svc"
            if [[ -d "$svc_dir" ]]; then
                local detected_mods
                detected_mods="$(list_subdirs "$svc_dir")"
                if [[ -n "$detected_mods" ]]; then
                    echo ""
                    echo -e "  ${CYAN}$_svc/${NC} has sub-modules: ${GREEN}$detected_mods${NC}"
                    read -r -p "  Use these as modules? (y/n/edit) [y]: " confirm
                    confirm="${confirm:-y}"
                    if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
                        SERVICE="$_svc"
                        MODULES="$detected_mods"
                    elif [[ "$confirm" != "n" && "$confirm" != "N" ]]; then
                        SERVICE="$_svc"
                        MODULES="$confirm"
                    fi
                    [[ -n "$SERVICE" ]] && break
                fi
            fi
        done
    fi

    if [[ -n "$SERVICE" && -z "$MODULES" ]]; then
        local svc_dir="$abs_target/$SERVICE"
        if [[ -d "$svc_dir" ]]; then
            MODULES="$(list_subdirs "$svc_dir")"
            [[ -n "$MODULES" ]] && echo -e "  Auto-detected modules in $SERVICE/: ${GREEN}$MODULES${NC}"
        fi
    fi

    if [[ -z "$ADAPTER" ]]; then
        if [[ "$detected_adapter" != "none" ]]; then
            read -r -p "  Adapter [$detected_adapter]: " input
            ADAPTER="${input:-$detected_adapter}"
        else
            read -r -p "  Adapter (claude-code/cursor/codex/generic/none) [none]: " input
            ADAPTER="${input:-none}"
        fi
    fi

    if [[ -z "$SYNC_MODE" ]]; then
        echo ""
        echo "  Sync mode — how agents check for incoming requests:"
        echo -e "    ${BOLD}1${NC}. on-action   — agent auto-checks before/after operations ${DIM}(recommended)${NC}"
        echo -e "    ${BOLD}2${NC}. auto-poll   — background script pulls every 5 minutes"
        echo -e "    ${BOLD}3${NC}. manual      — you run /accord-check-inbox explicitly"
        read -r -p "  Choice [1]: " sync_choice
        case "${sync_choice:-1}" in
            1|on-action)  SYNC_MODE="on-action" ;;
            2|auto-poll)  SYNC_MODE="auto-poll" ;;
            3|manual)     SYNC_MODE="manual" ;;
            *)            SYNC_MODE="on-action" ;;
        esac
    fi

    if [[ "$SCAN" == false ]]; then
        read -r -p "  Auto-scan source code for contracts? (y/n) [n]: " scan_input
        [[ "$scan_input" == "y" || "$scan_input" == "Y" ]] && SCAN=true
    fi
}

# ── Validation ───────────────────────────────────────────────────────────────

validate_inputs() {
    [[ -z "$PROJECT_NAME" ]] && err "Project name is required (--project-name or auto-detect)"
    [[ -z "$SERVICES" ]] && err "At least one service is required (--services or auto-detect)"

    [[ "$REPO_MODEL" != "monorepo" && "$REPO_MODEL" != "multi-repo" ]] && \
        err "Invalid repo model: $REPO_MODEL (must be monorepo or multi-repo)"

    if [[ "$REPO_MODEL" == "multi-repo" && -z "$HUB" ]]; then
        err "Hub repo URL is required for multi-repo model (--hub)"
    fi

    if [[ -n "$MODULES" && -z "$SERVICE" ]]; then
        err "Service name is required when modules are specified (--service)"
    fi

    if [[ -n "$SERVICE" && -z "$MODULES" ]]; then
        local svc_dir="$TARGET_DIR/$SERVICE"
        if [[ -d "$svc_dir" ]]; then
            MODULES="$(list_subdirs "$svc_dir")"
            [[ -n "$MODULES" ]] && log "Auto-detected modules in $SERVICE/: $MODULES"
        fi
    fi

    if [[ -n "$ROLE" ]]; then
        case "$ROLE" in
            orchestrator|service) ;;
            *) err "Invalid role: $ROLE (must be orchestrator or service)" ;;
        esac
    fi

    if [[ "$ROLE" == "orchestrator" && -z "$SERVICES" ]]; then
        err "--services is required for orchestrator role"
    fi

    if [[ "$INIT_SERVICES" == true && "$ROLE" != "orchestrator" ]]; then
        err "--init-services requires --role orchestrator"
    fi

    SYNC_MODE="${SYNC_MODE:-on-action}"
    ADAPTER="${ADAPTER:-none}"

    case "$LANGUAGE" in
        java|python|typescript|go) ;;
        *) err "Invalid language: $LANGUAGE (must be java, python, typescript, or go)" ;;
    esac
    case "$ADAPTER" in
        claude-code|cursor|codex|generic|none) ;;
        *) err "Invalid adapter: $ADAPTER" ;;
    esac
    case "$SYNC_MODE" in
        on-action|auto-poll|manual) ;;
        *) err "Invalid sync mode: $SYNC_MODE" ;;
    esac
}

# ── Config Generation ────────────────────────────────────────────────────────

generate_config() {
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

    # Build services section for config.yaml
    local services_yaml=""
    IFS=',' read -ra svc_arr <<< "$SERVICES"
    for svc in "${svc_arr[@]}"; do
        svc="$(echo "$svc" | xargs)"
        services_yaml="${services_yaml}
  - name: ${svc}"

        # If this service has modules, nest them
        if [[ "$svc" == "$SERVICE" && -n "$MODULES" ]]; then
            services_yaml="${services_yaml}
    modules:"
            IFS=',' read -ra mod_arr <<< "$MODULES"
            for mod in "${mod_arr[@]}"; do
                mod="$(echo "$mod" | xargs)"
                services_yaml="${services_yaml}
      - name: ${mod}
        path: ${svc}/${mod}/
        type: ${LANGUAGE}-interface"
            done
        fi
    done

    cat > "$config_file" <<EOF
version: "0.1"
project:
  name: ${PROJECT_NAME}

repo_model: ${REPO_MODEL}${hub_line}

services:${services_yaml}

settings:
  sync_mode: ${SYNC_MODE}
  auto_pull_on_start: true
  require_human_approval: true
  archive_completed: true
  debug: false
EOF

    log "Created $config_file"
}

# ── Directory Scaffolding ────────────────────────────────────────────────────

scaffold_project() {
    log "Scaffolding project: $PROJECT_NAME"

    local accord_dir="$TARGET_DIR/.accord"

    # .accord/contracts/
    mkdir -p "$accord_dir/contracts"
    IFS=',' read -ra svc_arr <<< "$SERVICES"

    # Multi-repo: only create own service's contract (first in list);
    # other services' contracts come via hub pull.
    # Monorepo: create all service contracts.
    for svc in "${svc_arr[@]}"; do
        svc="$(echo "$svc" | xargs)"
        if [[ "$REPO_MODEL" == "multi-repo" && "$svc" != "${svc_arr[0]// /}" ]]; then
            continue
        fi
        local contract_file="$accord_dir/contracts/${svc}.yaml"
        if [[ ! -f "$contract_file" ]]; then
            cp "$ACCORD_DIR/protocol/templates/contract.yaml.template" "$contract_file"
            replace_vars "$contract_file" \
                "SERVICE_NAME" "$svc" \
                "SCANNED_TIMESTAMP" "" \
                "RESOURCE" "example" \
                "RESOURCE_PASCAL" "Example"
            log "Created .accord/contracts/${svc}.yaml"
        fi
    done

    # .accord/contracts/internal/ (if modules exist)
    if [[ -n "$SERVICE" && -n "$MODULES" ]]; then
        mkdir -p "$accord_dir/contracts/internal"
        IFS=',' read -ra mod_arr <<< "$MODULES"
        for mod in "${mod_arr[@]}"; do
            mod="$(echo "$mod" | xargs)"
            local contract_file="$accord_dir/contracts/internal/${mod}.md"
            if [[ ! -f "$contract_file" ]]; then
                cp "$ACCORD_DIR/protocol/templates/internal-contract.md.template" "$contract_file"
                replace_vars "$contract_file" \
                    "MODULE_NAME" "$mod" \
                    "LANGUAGE" "$LANGUAGE"
                log "Created .accord/contracts/internal/${mod}.md"
            fi
        done
    fi

    # .accord/comms/
    mkdir -p "$accord_dir/comms/archive"
    for svc in "${svc_arr[@]}"; do
        svc="$(echo "$svc" | xargs)"
        mkdir -p "$accord_dir/comms/inbox/${svc}"
        touch "$accord_dir/comms/inbox/${svc}/.gitkeep"
    done

    # Module inboxes (same level as service inboxes)
    if [[ -n "$MODULES" ]]; then
        IFS=',' read -ra mod_arr <<< "$MODULES"
        for mod in "${mod_arr[@]}"; do
            mod="$(echo "$mod" | xargs)"
            mkdir -p "$accord_dir/comms/inbox/${mod}"
            touch "$accord_dir/comms/inbox/${mod}/.gitkeep"
        done
    fi

    # .accord/comms/PROTOCOL.md
    generate_comms_protocol "$accord_dir/comms/PROTOCOL.md"

    # .accord/comms/TEMPLATE.md
    if [[ ! -f "$accord_dir/comms/TEMPLATE.md" ]]; then
        cp "$ACCORD_DIR/protocol/templates/request.md.template" "$accord_dir/comms/TEMPLATE.md"
        log "Created .accord/comms/TEMPLATE.md"
    fi

    # .accord/log/ (debug logging)
    mkdir -p "$accord_dir/log"
    if [[ ! -f "$accord_dir/log/.gitignore" ]]; then
        echo "*.jsonl" > "$accord_dir/log/.gitignore"
        log "Created .accord/log/ with .gitignore"
    fi

    # .accord/.gitignore (runtime files)
    if [[ ! -f "$accord_dir/.gitignore" ]]; then
        echo ".last-sync-pull" > "$accord_dir/.gitignore"
        log "Created .accord/.gitignore"
    elif ! grep -q ".last-sync-pull" "$accord_dir/.gitignore" 2>/dev/null; then
        echo ".last-sync-pull" >> "$accord_dir/.gitignore"
    fi

    # Config (merged project + service)
    generate_config
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

Condensed protocol rules for participating agents. Full spec: see the Accord repository's `PROTOCOL.md`.

## Directory Layout (Centralized)

Everything lives under `.accord/`:

```
.accord/
├── config.yaml                        — Project configuration (services, modules, settings)
├── contracts/
│   ├── {service}.yaml                 — External contracts (OpenAPI). Only the owning module edits.
│   └── internal/
│       └── {module}.md                — Internal contracts (code-level interfaces)
└── comms/
    ├── inbox/{service-or-module}/     — Incoming requests
    ├── archive/                       — Completed/rejected requests
    ├── PROTOCOL.md                    — This file
    └── TEMPLATE.md                    — Request template
```

## Request Format

Markdown with YAML frontmatter. Required fields: `id`, `from`, `to`, `scope`, `type`, `priority`, `status`, `created`, `updated`. See `TEMPLATE.md`.

## State Machine

```
pending → approved → in-progress → completed
pending → rejected
```

## Rules

1. Never modify another module's contract directly — use a request.
2. Never auto-approve requests — human review is required.
3. A request cannot be `completed` unless the contract is updated.
4. Check your inbox on every session start (`git pull` first).
5. Use mock data / TODO markers while waiting for pending requests.

## Commit Convention

```
comms({module}): {action} - {summary}
contract({module}): {action} - {summary}
```

Actions: `request`, `approved`, `rejected`, `in-progress`, `completed`, `update`
PROTO

    log "Created .accord/comms/PROTOCOL.md"
}

# ── Watch Script (auto-poll sync mode) ──────────────────────────────────────

generate_watch_script() {
    [[ "$SYNC_MODE" != "auto-poll" ]] && return

    # Claude Code adapter uses native hooks instead of accord-watch.sh
    [[ "$ADAPTER" == "claude-code" ]] && return

    local watch_file="$TARGET_DIR/.accord/accord-watch.sh"

    if [[ -f "$watch_file" ]]; then
        warn "Watch script already exists (skipping)"
        return
    fi

    cat > "$watch_file" <<'WATCH'
#!/usr/bin/env bash
# Accord Watch — auto-poll for incoming requests
#
# Usage:
#   .accord/accord-watch.sh &              # run in background
#   .accord/accord-watch.sh --interval 60  # custom interval (seconds)

set -euo pipefail

INTERVAL=300
COMMS_DIR=".accord/comms"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --interval) INTERVAL="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

log() { echo "[accord-watch] $(date '+%H:%M:%S') $*"; }

# Read own service name from config (first service in list)
OWN_SVC=""
if [[ -f ".accord/config.yaml" ]]; then
    OWN_SVC="$(sed -n '/^services:/,/^[^ ]/{ s/^[[:space:]]*- name:[[:space:]]*//p; }' .accord/config.yaml | head -1 | xargs)"
fi

log "Started — polling every ${INTERVAL}s (pid $$)"

while true; do
    sleep "$INTERVAL"
    if git pull --quiet 2>/dev/null; then
        # Hub sync for multi-repo
        if [[ -d ".accord/hub/.git" ]]; then
            (cd ".accord/hub" && git pull --quiet 2>/dev/null) || log "Hub pull failed (offline?)"
            # Copy new requests from hub inbox to local inbox
            if [[ -n "$OWN_SVC" && -d ".accord/hub/comms/inbox/$OWN_SVC" ]]; then
                for req_file in ".accord/hub/comms/inbox/$OWN_SVC"/req-*.md; do
                    [[ -f "$req_file" ]] || continue
                    fname=$(basename "$req_file")
                    [[ -f "$COMMS_DIR/inbox/$OWN_SVC/$fname" ]] && continue
                    mkdir -p "$COMMS_DIR/inbox/$OWN_SVC"
                    cp "$req_file" "$COMMS_DIR/inbox/$OWN_SVC/$fname"
                    log "New request from hub: $fname"
                done
            fi
        fi

        count=0
        for inbox_dir in "$COMMS_DIR"/inbox/*/; do
            [[ ! -d "$inbox_dir" ]] && continue
            for f in "$inbox_dir"req-*.md; do
                [[ -f "$f" ]] && count=$((count + 1))
            done
        done
        [[ "$count" -gt 0 ]] && log "Found $count pending request(s) in inbox"
    else
        log "git pull failed (offline?)"
    fi
done
WATCH

    chmod +x "$watch_file"
    log "Created .accord/accord-watch.sh"
}

# ── Adapter Installation ─────────────────────────────────────────────────────

install_adapter() {
    [[ "$ADAPTER" == "none" ]] && return

    local adapter_dir="$ACCORD_DIR/adapters/$ADAPTER"
    [[ ! -d "$adapter_dir" ]] && { warn "Adapter directory not found: $adapter_dir"; return; }

    local install_script="$adapter_dir/install.sh"
    if [[ -f "$install_script" ]]; then
        log "Installing adapter: $ADAPTER"

        local modules_arg=""
        [[ -n "$MODULES" ]] && modules_arg="--module-list $MODULES"

        local internal_dir=""
        [[ -n "$MODULES" ]] && internal_dir=".accord/contracts/internal/"

        bash "$install_script" \
            --project-dir "$TARGET_DIR" \
            --project-name "$PROJECT_NAME" \
            --service-list "$SERVICES" \
            --contracts-dir ".accord/contracts/" \
            --internal-contracts-dir "${internal_dir:-N/A}" \
            --comms-dir ".accord/comms/" \
            --sync-mode "$SYNC_MODE" \
            ${modules_arg:+$modules_arg}

        log "Adapter $ADAPTER installed"
    else
        local instructions="$adapter_dir/AGENT_INSTRUCTIONS.md"
        if [[ -f "$instructions" ]]; then
            local dest="$TARGET_DIR/.accord/adapter/AGENT_INSTRUCTIONS.md"
            mkdir -p "$TARGET_DIR/.accord/adapter"
            cp "$instructions" "$dest"
            replace_vars "$dest" \
                "PROJECT_NAME" "$PROJECT_NAME" \
                "SERVICE_LIST" "$SERVICES" \
                "MODULE_LIST" "${MODULES:-}" \
                "CONTRACTS_DIR" ".accord/contracts/" \
                "INTERNAL_CONTRACTS_DIR" ".accord/contracts/internal/" \
                "COMMS_DIR" ".accord/comms/"
            log "Copied adapter instructions to $dest"
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

    IFS=',' read -ra svc_arr <<< "$SERVICES"
    for svc in "${svc_arr[@]}"; do
        svc="$(echo "$svc" | xargs)"
        if [[ -d "$TARGET_DIR/$svc" ]]; then
            log "Scanning service: $svc"
            (cd "$TARGET_DIR" && bash "$scan_script" --service "$svc" --type all 2>&1) || true
        fi
    done

    log "Validating existing contracts..."
    for f in "$TARGET_DIR/.accord/contracts"/*.yaml; do
        [[ -f "$f" ]] || continue
        echo -n "  $f ... "
        if bash "$ACCORD_DIR/protocol/scan/validators/validate-openapi.sh" "$f" 2>/dev/null; then
            echo "PASS"
        else
            echo "FAIL"
        fi
    done

    for f in "$TARGET_DIR/.accord/contracts/internal"/*.md; do
        [[ -f "$f" ]] || continue
        echo -n "  $f ... "
        if bash "$ACCORD_DIR/protocol/scan/validators/validate-internal.sh" "$f" 2>/dev/null; then
            echo "PASS"
        else
            echo "FAIL"
        fi
    done
}

# ── Hub Sync on Init (multi-repo) ─────────────────────────────────────────────

hub_sync_on_init() {
    [[ "$REPO_MODEL" != "multi-repo" ]] && return
    [[ -z "$HUB" ]] && return

    # Determine own service name (first in SERVICES list)
    IFS=',' read -ra svc_arr <<< "$SERVICES"
    local own_svc="${svc_arr[0]}"
    own_svc="$(echo "$own_svc" | xargs)"

    local hub_dir="$TARGET_DIR/.accord/hub"

    # a. Clone hub (or pull if already cloned)
    if [[ -d "$hub_dir/.git" ]]; then
        log "Hub already cloned, pulling latest..."
        (cd "$hub_dir" && git pull --quiet) || { warn "Hub pull failed (network issue?). Skipping hub sync."; return; }
    else
        log "Cloning hub: $HUB"
        if ! git clone "$HUB" "$hub_dir" 2>/dev/null; then
            warn "Hub clone failed (network issue or bad URL?). Skipping hub sync."
            return
        fi
    fi

    # Configure git user in hub clone (needed for commits)
    (cd "$hub_dir" && git config user.email "accord-init@local" && git config user.name "Accord Init") 2>/dev/null || true

    # If hub is empty (no structure), initialize it
    if [[ ! -d "$hub_dir/contracts" ]]; then
        log "Hub is empty — initializing structure"
        mkdir -p "$hub_dir/contracts"
        mkdir -p "$hub_dir/comms/archive"
        for svc in "${svc_arr[@]}"; do
            svc="$(echo "$svc" | xargs)"
            mkdir -p "$hub_dir/comms/inbox/$svc"
            touch "$hub_dir/comms/inbox/$svc/.gitkeep"
        done
        if ! (cd "$hub_dir" && git add -A && git commit -m "accord: init hub structure" && git push) 2>/dev/null; then
            warn "Failed to push hub init. Skipping hub sync."
            return
        fi
    fi

    # b. Pull: copy other services' contracts from hub → local
    #    Only copy if local file doesn't exist OR is still a template
    for f in "$hub_dir/contracts"/*.yaml; do
        [[ ! -f "$f" ]] && continue
        local fname
        fname="$(basename "$f")"
        local svc_name="${fname%.yaml}"
        [[ "$svc_name" == "$own_svc" ]] && continue
        local local_contract="$TARGET_DIR/.accord/contracts/$fname"
        if [[ ! -f "$local_contract" ]] || grep -q "^# Accord External Contract Template" "$local_contract" 2>/dev/null; then
            cp "$f" "$local_contract"
        fi
    done

    # c. Push: copy own contract → hub (always push, even if template —
    #    other services need to know this service exists)
    local own_contract="$TARGET_DIR/.accord/contracts/${own_svc}.yaml"
    if [[ -f "$own_contract" ]]; then
        mkdir -p "$hub_dir/contracts"
        cp "$own_contract" "$hub_dir/contracts/${own_svc}.yaml"
    fi

    # Ensure own inbox exists on hub
    mkdir -p "$hub_dir/comms/inbox/$own_svc"
    touch "$hub_dir/comms/inbox/$own_svc/.gitkeep"

    # d. Notify: place service-joined notification in other services' inboxes
    local ts
    ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    for svc in "${svc_arr[@]}"; do
        svc="$(echo "$svc" | xargs)"
        [[ "$svc" == "$own_svc" ]] && continue
        mkdir -p "$hub_dir/comms/inbox/$svc"
        local notify_file="$hub_dir/comms/inbox/$svc/req-000-service-joined-${own_svc}.md"
        # Idempotent: only write if not already present
        if [[ ! -f "$notify_file" ]]; then
            cat > "$notify_file" <<NOTIFY
---
id: req-000-service-joined-${own_svc}
from: ${own_svc}
to: ${svc}
scope: external
type: other
priority: low
status: pending
created: ${ts}
updated: ${ts}
---

## What

Service **${own_svc}** has joined the project. Run \`bash .accord/accord-sync.sh pull --target-dir .\` to fetch the latest contracts.

## Proposed Change

No contract changes. This is an informational notification.

## Why

New service registered in the Accord hub. Other services should pull to get the updated contract list.

## Impact

None — informational only. Pull when convenient.
NOTIFY
        fi
    done

    # Commit + push hub (only if there are changes)
    (cd "$hub_dir" && git add -A)
    if ! (cd "$hub_dir" && git diff --cached --quiet); then
        if (cd "$hub_dir" && git commit -m "accord-sync($own_svc): init — joined project" && git push) 2>/dev/null; then
            log "Hub synced: contract pushed, other services notified"
            HUB_SYNC_OK=true
        else
            warn "Failed to push to hub. Local init is complete but hub is not synced."
        fi
    else
        log "Hub already up to date"
        HUB_SYNC_OK=true
    fi
}

# ── Orchestrator Scaffolding (v2) ────────────────────────────────────────

generate_orchestrator_config() {
    local config_file="$TARGET_DIR/config.yaml"

    if [[ -f "$config_file" ]]; then
        warn "Config already exists: $config_file (skipping)"
        return
    fi

    local services_yaml=""
    IFS=',' read -ra svc_arr <<< "$SERVICES"
    for svc in "${svc_arr[@]}"; do
        svc="$(echo "$svc" | xargs)"
        services_yaml="${services_yaml}
  - name: ${svc}"
    done

    cat > "$config_file" <<EOF
version: "0.2"
role: orchestrator

project:
  name: ${PROJECT_NAME}

services:${services_yaml}

settings:
  sync_mode: ${SYNC_MODE}
  require_human_approval: true
  archive_completed: true
  history_enabled: true
EOF

    log "Created $config_file"
}

scaffold_orchestrator() {
    log "Scaffolding orchestrator hub: $PROJECT_NAME"

    # Flat structure (no .accord/ prefix — this IS the hub)
    mkdir -p "$TARGET_DIR/directives"
    touch "$TARGET_DIR/directives/.gitkeep"

    mkdir -p "$TARGET_DIR/registry"
    touch "$TARGET_DIR/registry/.gitkeep"

    mkdir -p "$TARGET_DIR/contracts"
    mkdir -p "$TARGET_DIR/contracts/internal"
    touch "$TARGET_DIR/contracts/.gitkeep"

    # comms structure
    mkdir -p "$TARGET_DIR/comms/archive"
    mkdir -p "$TARGET_DIR/comms/inbox/orchestrator"
    touch "$TARGET_DIR/comms/inbox/orchestrator/.gitkeep"

    IFS=',' read -ra svc_arr <<< "$SERVICES"
    for svc in "${svc_arr[@]}"; do
        svc="$(echo "$svc" | xargs)"
        mkdir -p "$TARGET_DIR/comms/inbox/${svc}"
        touch "$TARGET_DIR/comms/inbox/${svc}/.gitkeep"
    done

    mkdir -p "$TARGET_DIR/comms/history"
    touch "$TARGET_DIR/comms/history/.gitkeep"

    # PROTOCOL.md for hub comms
    if [[ ! -f "$TARGET_DIR/comms/PROTOCOL.md" ]]; then
        generate_comms_protocol "$TARGET_DIR/comms/PROTOCOL.md"
    fi

    # TEMPLATE.md (request template)
    if [[ ! -f "$TARGET_DIR/comms/TEMPLATE.md" ]]; then
        cp "$ACCORD_DIR/protocol/templates/request.md.template" "$TARGET_DIR/comms/TEMPLATE.md"
        log "Created comms/TEMPLATE.md"
    fi

    # Copy protocol helpers
    mkdir -p "$TARGET_DIR/protocol/history"
    cp "$ACCORD_DIR/protocol/history/write-history.sh" "$TARGET_DIR/protocol/history/write-history.sh"
    chmod +x "$TARGET_DIR/protocol/history/write-history.sh"
    log "Copied protocol/history/write-history.sh"

    mkdir -p "$TARGET_DIR/protocol/templates"
    cp "$ACCORD_DIR/protocol/templates/directive.md.template" "$TARGET_DIR/protocol/templates/directive.md.template"
    log "Copied protocol/templates/directive.md.template"

    # Generate config
    generate_orchestrator_config
}

install_orchestrator_adapter() {
    [[ "$ADAPTER" == "none" ]] && return

    local adapter_dir="$ACCORD_DIR/adapters/$ADAPTER"
    local orch_install="$adapter_dir/orchestrator/install.sh"

    if [[ -f "$orch_install" ]]; then
        log "Installing orchestrator adapter: $ADAPTER"
        bash "$orch_install" \
            --project-dir "$TARGET_DIR" \
            --project-name "$PROJECT_NAME" \
            --service-list "$SERVICES"
        log "Orchestrator adapter $ADAPTER installed"
    else
        warn "No orchestrator adapter found for: $ADAPTER"
    fi
}

print_orchestrator_summary() {
    echo ""
    echo -e "${BOLD}=== Accord orchestrator initialization complete ===${NC}"
    echo ""
    echo -e "  Project:    ${GREEN}$PROJECT_NAME${NC}"
    echo -e "  Role:       ${GREEN}orchestrator${NC}"
    echo -e "  Services:   ${GREEN}$SERVICES${NC}"
    [[ "$ADAPTER" != "none" ]] && echo -e "  Adapter:    ${GREEN}$ADAPTER${NC}"
    echo ""
    echo "  Created hub structure (flat):"
    echo "    config.yaml                     — Hub configuration (role: orchestrator)"
    echo "    directives/                     — High-level requirements"
    echo "    registry/                       — Service/module registries"
    echo "    contracts/                      — Service contracts"
    echo "    comms/"
    echo "        ├── inbox/orchestrator/     — Escalated requests"
    echo "        ├── inbox/{service}/        — Per-service inboxes"
    echo "        ├── archive/               — Completed/rejected requests"
    echo "        ├── history/               — Audit log (JSONL)"
    echo "        └── PROTOCOL.md / TEMPLATE.md"
    if [[ "$ADAPTER" != "none" ]]; then
    echo "    CLAUDE.md                       — Orchestrator agent instructions"
    echo "    .claude/commands/               — Orchestrator slash commands"
    fi
    echo ""
    echo "  Next steps:"
    if [[ "$INIT_SERVICES" == true ]]; then
    echo "    1. Commit hub: git add . && git commit -m 'accord: init orchestrator hub'"
    echo "    2. Commit each service repo"
    echo "    3. Start agent sessions (one per repo) and begin working"
    else
    echo "    1. git add . && git commit -m 'accord: init orchestrator hub'"
    echo "    2. Init service repos: re-run with --init-services, or init each service individually"
    echo "    3. Create directives in directives/ for feature decomposition"
    echo "    4. Start your orchestrator agent — it will read registries and process directives"
    fi
    echo ""
}

# ── Registry Generation ──────────────────────────────────────────────────

generate_registry() {
    local registry_dir="$TARGET_DIR/.accord/registry"
    mkdir -p "$registry_dir"

    IFS=',' read -ra svc_arr <<< "$SERVICES"
    for svc in "${svc_arr[@]}"; do
        svc="$(echo "$svc" | xargs)"
        local registry_file="$registry_dir/${svc}.md"
        if [[ ! -f "$registry_file" ]]; then
            cp "$ACCORD_DIR/protocol/templates/registry.md.template" "$registry_file"
            local contract_path=".accord/contracts/${svc}.yaml"
            local module_type="service"
            local module_dir="${svc}/"
            replace_vars "$registry_file" \
                "MODULE_NAME" "$svc" \
                "MODULE_TYPE" "$module_type" \
                "LANGUAGE" "$LANGUAGE" \
                "MODULE_DIR" "$module_dir" \
                "CONTRACT_PATH" "$contract_path"
            log "Created .accord/registry/${svc}.md"
        fi
    done

    # Generate registry files for sub-modules
    if [[ -n "$SERVICE" && -n "$MODULES" ]]; then
        IFS=',' read -ra mod_arr <<< "$MODULES"
        for mod in "${mod_arr[@]}"; do
            mod="$(echo "$mod" | xargs)"
            local registry_file="$registry_dir/${mod}.md"
            if [[ ! -f "$registry_file" ]]; then
                cp "$ACCORD_DIR/protocol/templates/registry.md.template" "$registry_file"
                local contract_path=".accord/contracts/internal/${mod}.md"
                local module_type="module"
                local module_dir="${SERVICE}/${mod}/"
                replace_vars "$registry_file" \
                    "MODULE_NAME" "$mod" \
                    "MODULE_TYPE" "$module_type" \
                    "LANGUAGE" "$LANGUAGE" \
                    "MODULE_DIR" "$module_dir" \
                    "CONTRACT_PATH" "$contract_path"
                log "Created .accord/registry/${mod}.md"
            fi
        done
    fi
}

# ── Summary ──────────────────────────────────────────────────────────────────

print_summary() {
    echo ""
    echo -e "${BOLD}=== Accord initialization complete ===${NC}"
    echo ""
    echo -e "  Project:    ${GREEN}$PROJECT_NAME${NC}"
    echo -e "  Repo model: ${GREEN}$REPO_MODEL${NC}"
    echo -e "  Services:   ${GREEN}$SERVICES${NC}"
    [[ -n "$SERVICE" ]] && echo -e "  Modules:    ${GREEN}$SERVICE/ → $MODULES${NC}"
    [[ "$ADAPTER" != "none" ]] && echo -e "  Adapter:    ${GREEN}$ADAPTER${NC}"
    echo -e "  Sync mode:  ${GREEN}$SYNC_MODE${NC}"
    [[ "$REPO_MODEL" == "multi-repo" ]] && echo -e "  Hub:        ${GREEN}$HUB${NC}"
    echo ""
    echo "  Created structure:"
    echo "    .accord/"
    echo "    ├── config.yaml                 — Project configuration"
    echo "    ├── contracts/{service}.yaml     — External contracts"
    [[ -n "$MODULES" ]] && \
    echo "    ├── contracts/internal/{mod}.md — Internal contracts"
    echo "    ├── registry/{name}.md          — Module registry"
    echo "    └── comms/"
    echo "        ├── inbox/{service}/        — Service inboxes"
    [[ -n "$MODULES" ]] && \
    echo "        ├── inbox/{module}/        — Module inboxes"
    echo "        ├── archive/               — Completed requests"
    echo "        └── PROTOCOL.md / TEMPLATE.md"
    if [[ "$SYNC_MODE" == "auto-poll" && "$ADAPTER" != "claude-code" ]]; then
    echo "    .accord/accord-watch.sh         — Background polling"
    elif [[ "$SYNC_MODE" == "auto-poll" && "$ADAPTER" == "claude-code" ]]; then
    echo "    .accord/hooks/accord-auto-sync.sh — Auto-sync via Claude Code hooks"
    fi
    echo ""
    echo "  Next steps:"
    if [[ "$SCAN" == true ]]; then
        echo "    1. Review generated contracts (status: draft) and change to 'stable'"
    else
        echo "    1. Edit contracts in .accord/contracts/ to match your actual APIs"
    fi
    echo "    2. git add .accord && git commit -m 'accord: init project'"
    echo "    3. Start your agent — it will check the inbox on start"
    if [[ "$SYNC_MODE" == "auto-poll" && "$ADAPTER" != "claude-code" ]]; then
        echo "    4. Run: .accord/accord-watch.sh &"
    fi
    if [[ "$REPO_MODEL" == "multi-repo" ]]; then
        echo ""
        if [[ "$HUB_SYNC_OK" == true ]]; then
            echo "  Hub synced automatically. Other services have been notified."
            echo "  Use '.accord/accord-sync.sh pull' to check for updates, '.accord/accord-sync.sh push' to publish changes."
        else
            echo "  Multi-repo setup detected. Hub sync was not completed."
            echo "  To connect to the hub manually:"
            echo "    bash .accord/accord-sync.sh init --target-dir ."
            echo "  Then use '.accord/accord-sync.sh pull' and '.accord/accord-sync.sh push' to sync."
        fi
    fi
    echo ""
}

# ── Batch Service Init (--init-services) ─────────────────────────────────────

init_service_repos() {
    # Resolve hub URL: explicit --hub > git remote > error
    local hub_url="$HUB"
    if [[ -z "$hub_url" ]]; then
        hub_url="$(git -C "$TARGET_DIR" remote get-url origin 2>/dev/null || true)"
    fi
    if [[ -z "$hub_url" ]]; then
        err "--init-services requires a hub URL. Use --hub <url> or ensure the hub repo has a git remote."
    fi

    local parent_dir
    parent_dir="$(dirname "$TARGET_DIR")"

    local svc_count=0
    local svc_skipped=0

    IFS=',' read -ra svc_arr <<< "$SERVICES"
    for svc in "${svc_arr[@]}"; do
        svc="$(echo "$svc" | xargs)"
        local svc_dir="$parent_dir/$svc"

        if [[ ! -d "$svc_dir" ]]; then
            warn "Service directory not found: $svc_dir (skipping)"
            svc_skipped=$((svc_skipped + 1))
            continue
        fi

        log "Initializing service: $svc → $svc_dir"
        bash "$ACCORD_DIR/init.sh" \
            --target-dir "$svc_dir" \
            --project-name "$PROJECT_NAME" \
            --repo-model multi-repo \
            --hub "$hub_url" \
            --services "$SERVICES" \
            --adapter "$ADAPTER" \
            --language "$LANGUAGE" \
            --sync-mode "${SYNC_MODE}" \
            --no-interactive || {
            warn "Failed to initialize service: $svc"
            svc_skipped=$((svc_skipped + 1))
            continue
        }

        svc_count=$((svc_count + 1))
    done

    echo ""
    log "Batch init complete: $svc_count services initialized, $svc_skipped skipped"
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    parse_args "$@"

    if [[ "$INTERACTIVE" == true ]] && ! tty -s 2>/dev/null; then
        INTERACTIVE=false
    fi

    TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

    # Idempotency: skip if already initialized (unless --force)
    # Orchestrator uses flat config.yaml; service uses .accord/config.yaml
    if [[ "$FORCE" != "true" ]]; then
        if [[ "$ROLE" == "orchestrator" && -f "$TARGET_DIR/config.yaml" ]]; then
            log "Already initialized ($TARGET_DIR/config.yaml exists). Use --force to re-initialize."
            exit 0
        elif [[ "$ROLE" != "orchestrator" && -f "$TARGET_DIR/.accord/config.yaml" ]]; then
            log "Already initialized ($TARGET_DIR/.accord/config.yaml exists). Use --force to re-initialize."
            exit 0
        fi
    fi

    if [[ "$INTERACTIVE" == false ]]; then
        [[ -z "$PROJECT_NAME" ]] && PROJECT_NAME="$(detect_project_name "$TARGET_DIR")"
        [[ -z "$ADAPTER" ]] && ADAPTER="$(detect_adapter "$TARGET_DIR")"
        [[ -z "$SERVICES" ]] && SERVICES="$(list_subdirs "$TARGET_DIR")"
        [[ -z "$SERVICES" ]] && SERVICES="$PROJECT_NAME"
        LANGUAGE="$(detect_language "$TARGET_DIR")"

        if [[ -z "$SERVICE" && -n "$SERVICES" ]]; then
            IFS=',' read -ra _svcs <<< "$SERVICES"
            for _svc in "${_svcs[@]}"; do
                _svc="$(echo "$_svc" | xargs)"
                if [[ -d "$TARGET_DIR/$_svc" ]]; then
                    local mods
                    mods="$(list_subdirs "$TARGET_DIR/$_svc")"
                    if [[ -n "$mods" ]]; then
                        SERVICE="$_svc"
                        MODULES="$mods"
                        break
                    fi
                fi
            done
        fi

        log "Auto-detected: project=$PROJECT_NAME services=$SERVICES adapter=${ADAPTER:-none} lang=$LANGUAGE"
        [[ -n "$SERVICE" ]] && log "Auto-detected: service=$SERVICE modules=$MODULES"
    fi

    [[ "$INTERACTIVE" == true ]] && interactive_prompt

    validate_inputs

    if [[ "$ROLE" == "orchestrator" ]]; then
        scaffold_orchestrator
        install_orchestrator_adapter
        print_orchestrator_summary
        if [[ "$INIT_SERVICES" == true ]]; then
            init_service_repos
        fi
    else
        scaffold_project
        generate_registry
        hub_sync_on_init
        generate_watch_script

        # Copy accord-sync.sh to .accord/ for local use
        if [[ -f "$ACCORD_DIR/accord-sync.sh" ]]; then
            cp "$ACCORD_DIR/accord-sync.sh" "$TARGET_DIR/.accord/accord-sync.sh"
            chmod +x "$TARGET_DIR/.accord/accord-sync.sh"
            log "Copied accord-sync.sh to .accord/"
        fi

        install_adapter
        run_scan
        print_summary
    fi
}

main "$@"
