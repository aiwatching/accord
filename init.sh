#!/usr/bin/env bash
# Accord Project Initialization Script
# Scaffolds directory structure, config files, and adapter installation.
#
# Usage:
#   ./init.sh                                           # Interactive mode
#   ./init.sh --project-name my-project --teams "a,b"   # Flags mode
#
# See --help for all options.

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────

PROJECT_NAME=""
REPO_MODEL=""
TEAMS=""
ADAPTER="none"
SERVICE=""
MODULES=""
HUB=""
LANGUAGE="java"
TARGET_DIR="."
INTERACTIVE=true
SCAN=false

# ── Helpers ───────────────────────────────────────────────────────────────────

usage() {
    cat <<'HELP'
Usage: init.sh [options]

Options:
  --project-name <name>       Project name (required)
  --repo-model <model>        monorepo | multi-repo (default: monorepo)
  --teams <csv>               Comma-separated team names (required)
  --adapter <name>            claude-code | cursor | codex | generic | none (default: none)
  --scan                      After scaffolding, output scan prompts for contract generation
  --service <name>            Service name (for service-level config with modules)
  --modules <csv>             Comma-separated module names within the service
  --hub <git-url>             Hub repo URL (multi-repo only)
  --language <lang>           java | python | typescript | go (default: java)
  --target-dir <path>         Target directory (default: current directory)
  --no-interactive            Skip interactive prompts, use flags only
  --help                      Show this help message

Examples:
  # Interactive mode
  ./init.sh

  # Monorepo with Claude Code adapter
  ./init.sh --project-name next-nac \
            --repo-model monorepo \
            --teams "frontend,nac-engine,device-manager,nac-admin" \
            --adapter claude-code \
            --no-interactive

  # Service with sub-modules
  ./init.sh --project-name next-nac \
            --repo-model monorepo \
            --teams "frontend,nac-engine,device-manager" \
            --service device-manager \
            --modules "plugin,discovery,lifecycle" \
            --language java \
            --no-interactive
HELP
}

log() { echo "[accord] $*"; }
warn() { echo "[accord] WARNING: $*" >&2; }
err() { echo "[accord] ERROR: $*" >&2; exit 1; }

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

# ── Argument Parsing ─────────────────────────────────────────────────────────

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --project-name)   PROJECT_NAME="$2"; shift 2 ;;
            --repo-model)     REPO_MODEL="$2"; shift 2 ;;
            --teams)          TEAMS="$2"; shift 2 ;;
            --adapter)        ADAPTER="$2"; shift 2 ;;
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
    echo ""
    echo "=== Accord Project Initialization ==="
    echo ""

    if [[ -z "$PROJECT_NAME" ]]; then
        read -r -p "Project name: " PROJECT_NAME
    fi

    if [[ -z "$REPO_MODEL" ]]; then
        read -r -p "Repository model (monorepo/multi-repo) [monorepo]: " REPO_MODEL
        REPO_MODEL="${REPO_MODEL:-monorepo}"
    fi

    if [[ -z "$TEAMS" ]]; then
        read -r -p "Team names (comma-separated): " TEAMS
    fi

    if [[ "$REPO_MODEL" == "multi-repo" && -z "$HUB" ]]; then
        read -r -p "Hub repo URL: " HUB
    fi

    if [[ -z "$SERVICE" ]]; then
        read -r -p "Service with sub-modules? (name or empty to skip): " SERVICE
    fi

    if [[ -n "$SERVICE" && -z "$MODULES" ]]; then
        read -r -p "Module names for $SERVICE (comma-separated): " MODULES
    fi

    if [[ -n "$SERVICE" && -n "$MODULES" && "$LANGUAGE" == "java" ]]; then
        read -r -p "Language for module contracts (java/python/typescript/go) [java]: " lang_input
        LANGUAGE="${lang_input:-java}"
    fi

    if [[ "$ADAPTER" == "none" ]]; then
        read -r -p "Install adapter? (claude-code/cursor/codex/generic/none) [none]: " ADAPTER
        ADAPTER="${ADAPTER:-none}"
    fi

    if [[ "$SCAN" == false ]]; then
        read -r -p "Auto-scan source code for contracts? (y/n) [n]: " scan_input
        [[ "$scan_input" == "y" || "$scan_input" == "Y" ]] && SCAN=true
    fi
}

# ── Validation ───────────────────────────────────────────────────────────────

validate_inputs() {
    [[ -z "$PROJECT_NAME" ]] && err "Project name is required (--project-name)"
    [[ -z "$TEAMS" ]] && err "At least one team is required (--teams)"

    REPO_MODEL="${REPO_MODEL:-monorepo}"
    [[ "$REPO_MODEL" != "monorepo" && "$REPO_MODEL" != "multi-repo" ]] && \
        err "Invalid repo model: $REPO_MODEL (must be monorepo or multi-repo)"

    if [[ "$REPO_MODEL" == "multi-repo" && -z "$HUB" ]]; then
        err "Hub repo URL is required for multi-repo model (--hub)"
    fi

    if [[ -n "$MODULES" && -z "$SERVICE" ]]; then
        err "Service name is required when modules are specified (--service)"
    fi

    case "$LANGUAGE" in
        java|python|typescript|go) ;;
        *) err "Invalid language: $LANGUAGE (must be java, python, typescript, or go)" ;;
    esac

    case "$ADAPTER" in
        claude-code|cursor|codex|generic|none) ;;
        *) err "Invalid adapter: $ADAPTER (must be claude-code, cursor, codex, generic, or none)" ;;
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
    echo "=== Accord initialization complete ==="
    echo ""
    echo "  Project:    $PROJECT_NAME"
    echo "  Repo model: $REPO_MODEL"
    echo "  Teams:      $TEAMS"
    [[ -n "$SERVICE" ]] && echo "  Service:    $SERVICE (modules: $MODULES)"
    [[ "$ADAPTER" != "none" ]] && echo "  Adapter:    $ADAPTER"
    echo ""
    echo "Created structure:"
    echo "  .accord/config.yaml          — Project configuration"
    echo "  contracts/                    — External contracts (one per team)"
    echo "  .agent-comms/                — Communication directory"
    echo "  .agent-comms/inbox/{team}/   — Team inboxes"
    echo "  .agent-comms/PROTOCOL.md     — Protocol reference"
    echo "  .agent-comms/TEMPLATE.md     — Request template"
    if [[ -n "$SERVICE" ]]; then
        echo "  $SERVICE/.accord/config.yaml — Service configuration"
        echo "  $SERVICE/.accord/internal-contracts/ — Collected module contracts"
        echo "  $SERVICE/.agent-comms/       — Module communication"
    fi
    echo ""
    echo "Next steps:"
    if [[ "$SCAN" == true ]]; then
        echo "  1. Review generated contracts (status: draft) and change to 'stable' when ready"
    else
        echo "  1. Edit contracts in contracts/ to match your actual APIs"
        echo "     Or run with --scan to auto-generate from source code"
    fi
    if [[ -n "$SERVICE" ]]; then
        echo "  2. Edit internal contracts in $SERVICE/{module}/.accord/contract.md"
    fi
    echo "  3. Commit the scaffolded structure: git add -A && git commit -m 'accord: init project'"
    echo "  4. Each team member starts their agent — it will check the inbox on start"
    if [[ "$ADAPTER" == "claude-code" ]]; then
        echo ""
        echo "  Claude Code users: use /accord-init for a fully automated setup experience"
    fi
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    parse_args "$@"

    # Auto-disable interactive mode when stdin is not a terminal (e.g., curl | bash)
    if [[ "$INTERACTIVE" == true ]] && ! tty -s 2>/dev/null; then
        INTERACTIVE=false
        if [[ -z "$PROJECT_NAME" ]]; then
            err "Piped input detected — interactive prompts unavailable. Pass flags instead:
  curl ... | bash -s -- --project-name my-app --teams \"a,b\" --adapter claude-code --no-interactive"
        fi
    fi

    if [[ "$INTERACTIVE" == true && -z "$PROJECT_NAME" ]]; then
        interactive_prompt
    fi

    validate_inputs

    TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

    scaffold_project
    scaffold_service
    install_adapter
    run_scan
    print_summary
}

main "$@"
