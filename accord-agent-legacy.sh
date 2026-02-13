#!/usr/bin/env bash
# Accord Agent — autonomous request processing daemon
#
# Polls service inboxes and processes all request types:
#   - type: command → shell fast-path (no AI agent needed)
#   - all other types → invokes an AI agent for autonomous implementation
#
# Usage:
#   accord-agent.sh start    [--target-dir <dir>] [--interval <sec>] [--agent-cmd <cmd>] [--timeout <sec>]
#   accord-agent.sh stop     [--target-dir <dir>]
#   accord-agent.sh status   [--target-dir <dir>]
#   accord-agent.sh run-once [--target-dir <dir>] [--agent-cmd <cmd>] [--timeout <sec>]
#   accord-agent.sh start-all [--target-dir <hub-dir>]
#   accord-agent.sh stop-all  [--target-dir <hub-dir>]

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────

SUBCOMMAND=""
TARGET_DIR="."
INTERVAL=60
AGENT_CMD_FLAG=""
TIMEOUT=600
MAX_ATTEMPTS=3
DEFAULT_AGENT_CMD="claude --dangerously-skip-permissions -p"

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo "[accord-agent] $(date '+%H:%M:%S') $*"; }
warn() { echo "[accord-agent] WARNING: $*" >&2; }
err() { echo "[accord-agent] ERROR: $*" >&2; exit 1; }

usage() {
    cat <<'HELP'
Usage: accord-agent.sh <command> [options]

Autonomous request processing daemon for Accord services.
Processes all request types: command requests via shell fast-path,
all other types via an AI agent (Claude Code by default).

Commands:
  start       Start the daemon (background)
  stop        Stop the daemon
  status      Show daemon status
  run-once    Process requests once, then exit
  start-all   Start daemons for all services (from hub)
  stop-all    Stop daemons for all services (from hub)
  status-all  Show status dashboard for all services (from hub)

Options:
  --target-dir <path>     Project directory (default: current directory)
  --interval <seconds>    Polling interval for start (default: 60)
  --agent-cmd <command>   AI agent command (default: "claude --dangerously-skip-permissions -p")
  --timeout <seconds>     Per-request agent timeout (default: 600)
  --help                  Show this help message

Agent command resolution order:
  1. --agent-cmd flag
  2. settings.agent_cmd in .accord/config.yaml
  3. Built-in default (claude --dangerously-skip-permissions -p)
HELP
}

# Read a simple YAML value: yaml_val "key" "file"
yaml_val() {
    local key="$1" file="$2"
    sed -n "s/^${key}:[[:space:]]*//p" "$file" | head -1 | tr -d '"' | tr -d "'" | xargs
}

# Read a YAML value that may be indented (e.g. settings.agent_cmd)
yaml_setting() {
    local key="$1" file="$2"
    sed -n "s/^[[:space:]]*${key}:[[:space:]]*//p" "$file" | head -1 | tr -d '"' | tr -d "'" | xargs
}

# List all service names from config
yaml_all_services() {
    local file="$1"
    sed -n '/^services:/,/^[^ ]/{ s/^[[:space:]]*- name:[[:space:]]*//p; }' "$file"
}

# Read value from request frontmatter (between --- lines)
req_field() {
    local field="$1" file="$2"
    sed -n '/^---$/,/^---$/{ s/^'"$field"':[[:space:]]*//p; }' "$file" | head -1 | xargs
}

# Set or add a field in request frontmatter
set_req_field() {
    local field="$1" value="$2" file="$3"
    # Check within frontmatter only (between --- lines), not the body
    if sed -n '/^---$/,/^---$/p' "$file" | grep -q "^${field}:"; then
        sed '/^---$/,/^---$/{ s/^'"${field}"':[[:space:]]*.*/'"${field}"': '"${value}"'/; }' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
    else
        # Insert before the closing --- (second occurrence)
        awk -v f="$field" -v v="$value" 'BEGIN{n=0} /^---$/{n++; if(n==2){print f": "v}} {print}' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
    fi
}

# ── Argument Parsing ─────────────────────────────────────────────────────────

parse_args() {
    [[ $# -eq 0 ]] && { usage; exit 0; }

    SUBCOMMAND="$1"; shift

    case "$SUBCOMMAND" in
        start|stop|status|run-once|start-all|stop-all|status-all) ;;
        --help|-h) usage; exit 0 ;;
        *) err "Unknown command: $SUBCOMMAND" ;;
    esac

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --target-dir) TARGET_DIR="$2"; shift 2 ;;
            --interval)   INTERVAL="$2"; shift 2 ;;
            --agent-cmd)  AGENT_CMD_FLAG="$2"; shift 2 ;;
            --timeout)    TIMEOUT="$2"; shift 2 ;;
            --help)       usage; exit 0 ;;
            *)            err "Unknown option: $1" ;;
        esac
    done
}

# ── Logging ──────────────────────────────────────────────────────────────────

log_file() {
    local log_dir="$TARGET_DIR/.accord/log"
    mkdir -p "$log_dir"
    echo "$log_dir/agent-$(date -u '+%Y-%m-%d').log"
}

log_to_file() {
    local msg="[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
    echo "$msg" >> "$(log_file)"
}

# ── PID Management ───────────────────────────────────────────────────────────

pid_file() {
    echo "$TARGET_DIR/.accord/.agent.pid"
}

is_running() {
    local pf
    pf="$(pid_file)"
    if [[ ! -f "$pf" ]]; then
        return 1
    fi
    local pid
    pid="$(cat "$pf")"
    if kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    # Stale PID file
    rm -f "$pf"
    return 1
}

write_pid() {
    echo "$1" > "$(pid_file)"
}

remove_pid() {
    rm -f "$(pid_file)"
}

# ── Sync ─────────────────────────────────────────────────────────────────────

do_sync_pull() {
    local sync_script="$TARGET_DIR/.accord/accord-sync.sh"
    if [[ -f "$sync_script" ]]; then
        bash "$sync_script" pull --target-dir "$TARGET_DIR" 2>/dev/null || log_to_file "Sync pull failed"
    elif git -C "$TARGET_DIR" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
        git -C "$TARGET_DIR" pull --quiet 2>/dev/null || log_to_file "Git pull failed"
    fi
}

do_sync_push() {
    local sync_script="$TARGET_DIR/.accord/accord-sync.sh"
    if [[ -f "$sync_script" ]]; then
        bash "$sync_script" push --target-dir "$TARGET_DIR" 2>/dev/null || log_to_file "Sync push failed"
    elif git -C "$TARGET_DIR" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
        # Stage and commit any pending changes
        (cd "$TARGET_DIR" && git add -A && git diff --cached --quiet) || \
            (cd "$TARGET_DIR" && git commit -m "accord-agent: process request(s)" 2>/dev/null) || true
        # Skip push if no remote configured
        if ! git -C "$TARGET_DIR" remote get-url origin > /dev/null 2>&1; then
            return 0
        fi
        # Push with pull --rebase + retry
        local max_retries=3
        local attempt=0
        while [[ $attempt -lt $max_retries ]]; do
            if (cd "$TARGET_DIR" && git push 2>/dev/null); then
                return 0
            fi
            attempt=$((attempt + 1))
            log_to_file "Push conflict, pulling with rebase (attempt $attempt/$max_retries)"
            if ! (cd "$TARGET_DIR" && git pull --rebase 2>/dev/null); then
                log_to_file "Rebase failed, manual resolution needed"
                return 1
            fi
        done
        log_to_file "Push failed after $max_retries attempts"
    fi
}

# ── Command Executors ────────────────────────────────────────────────────────

exec_cmd_status() {
    local config="$TARGET_DIR/.accord/config.yaml"
    local output=""

    output="### Status Report\n"

    # Project name
    if [[ -f "$config" ]]; then
        local project
        project="$(yaml_val "project" "$config")"
        output="${output}\n- **Project**: ${project:-unknown}\n"
    fi

    # Count contracts
    local ext_count=0
    local int_count=0
    for f in "$TARGET_DIR/.accord/contracts/"*.yaml; do
        if [[ -f "$f" ]]; then
            ext_count=$((ext_count + 1))
        fi
    done
    for f in "$TARGET_DIR/.accord/contracts/internal/"*.md; do
        if [[ -f "$f" ]]; then
            int_count=$((int_count + 1))
        fi
    done
    output="${output}- **External contracts**: $ext_count\n"
    output="${output}- **Internal contracts**: $int_count\n"

    # Count inbox items
    local inbox_count=0
    for f in "$TARGET_DIR/.accord/comms/inbox/"*/req-*.md; do
        if [[ -f "$f" ]]; then
            inbox_count=$((inbox_count + 1))
        fi
    done
    output="${output}- **Inbox items**: $inbox_count\n"

    # Count archived items
    local archive_count=0
    for f in "$TARGET_DIR/.accord/comms/archive/"req-*.md; do
        if [[ -f "$f" ]]; then
            archive_count=$((archive_count + 1))
        fi
    done
    output="${output}- **Archived items**: $archive_count\n"

    printf "%b" "$output"
}

exec_cmd_scan() {
    local output=""
    local errors=0
    local checked=0

    output="### Scan Report\n"

    # Validate external contracts
    for f in "$TARGET_DIR/.accord/contracts/"*.yaml; do
        if [[ ! -f "$f" ]]; then
            continue
        fi
        checked=$((checked + 1))
        local fname
        fname="$(basename "$f")"
        local result
        if result=$(bash "$ACCORD_DIR/protocol/scan/validators/validate-openapi.sh" "$f" 2>&1); then
            output="${output}\n- **$fname**: PASS\n"
        else
            output="${output}\n- **$fname**: FAIL\n${result}\n"
            errors=$((errors + 1))
        fi
    done

    # Validate internal contracts
    for f in "$TARGET_DIR/.accord/contracts/internal/"*.md; do
        if [[ ! -f "$f" ]]; then
            continue
        fi
        checked=$((checked + 1))
        local fname
        fname="$(basename "$f")"
        local result
        if result=$(bash "$ACCORD_DIR/protocol/scan/validators/validate-internal.sh" "$f" 2>&1); then
            output="${output}\n- **$fname**: PASS\n"
        else
            output="${output}\n- **$fname**: FAIL\n${result}\n"
            errors=$((errors + 1))
        fi
    done

    output="${output}\n**Checked**: $checked, **Errors**: $errors\n"
    printf "%b" "$output"
}

exec_cmd_check_inbox() {
    local output=""
    local count=0

    output="### Inbox Report\n\n"
    output="${output}| ID | Type | Status | From |\n"
    output="${output}|----|------|--------|------|\n"

    for inbox_dir in "$TARGET_DIR/.accord/comms/inbox/"*/; do
        if [[ ! -d "$inbox_dir" ]]; then
            continue
        fi
        for f in "$inbox_dir"req-*.md; do
            if [[ ! -f "$f" ]]; then
                continue
            fi
            count=$((count + 1))
            local rid rtype rstatus rfrom
            rid="$(req_field "id" "$f")"
            rtype="$(req_field "type" "$f")"
            rstatus="$(req_field "status" "$f")"
            rfrom="$(req_field "from" "$f")"
            output="${output}| $rid | $rtype | $rstatus | $rfrom |\n"
        done
    done

    output="${output}\n**Total**: $count item(s)\n"
    printf "%b" "$output"
}

exec_cmd_validate() {
    local output=""
    local total_errors=0
    local total_checked=0

    output="### Validation Report\n"

    # Validate external contracts (OpenAPI)
    output="${output}\n#### External Contracts\n"
    for f in "$TARGET_DIR/.accord/contracts/"*.yaml; do
        if [[ ! -f "$f" ]]; then
            continue
        fi
        total_checked=$((total_checked + 1))
        local fname
        fname="$(basename "$f")"
        local result
        if result=$(bash "$ACCORD_DIR/protocol/scan/validators/validate-openapi.sh" "$f" 2>&1); then
            output="${output}- $fname: PASS\n"
        else
            output="${output}- $fname: FAIL — $result\n"
            total_errors=$((total_errors + 1))
        fi
    done

    # Validate internal contracts
    output="${output}\n#### Internal Contracts\n"
    for f in "$TARGET_DIR/.accord/contracts/internal/"*.md; do
        if [[ ! -f "$f" ]]; then
            continue
        fi
        total_checked=$((total_checked + 1))
        local fname
        fname="$(basename "$f")"
        local result
        if result=$(bash "$ACCORD_DIR/protocol/scan/validators/validate-internal.sh" "$f" 2>&1); then
            output="${output}- $fname: PASS\n"
        else
            output="${output}- $fname: FAIL — $result\n"
            total_errors=$((total_errors + 1))
        fi
    done

    # Validate request files in inbox
    output="${output}\n#### Requests\n"
    for inbox_dir in "$TARGET_DIR/.accord/comms/inbox/"*/; do
        if [[ ! -d "$inbox_dir" ]]; then
            continue
        fi
        for f in "$inbox_dir"req-*.md; do
            if [[ ! -f "$f" ]]; then
                continue
            fi
            total_checked=$((total_checked + 1))
            local fname
            fname="$(basename "$f")"
            local result
            if result=$(bash "$ACCORD_DIR/protocol/scan/validators/validate-request.sh" "$f" 2>&1); then
                output="${output}- $fname: PASS\n"
            else
                output="${output}- $fname: FAIL — $result\n"
                total_errors=$((total_errors + 1))
            fi
        done
    done

    output="${output}\n**Checked**: $total_checked, **Errors**: $total_errors\n"
    printf "%b" "$output"
}

# ── Agent Support ────────────────────────────────────────────────────────────

# Run a command with a timeout (macOS-compatible, no GNU timeout needed)
# Returns: 0 on success, 124 on timeout, else the command's exit code
run_with_timeout() {
    local timeout_sec="$1"; shift

    "$@" &
    local cmd_pid=$!

    (
        sleep "$timeout_sec"
        kill "$cmd_pid" 2>/dev/null
    ) &
    local watchdog_pid=$!

    local exit_code=0
    wait "$cmd_pid" 2>/dev/null || exit_code=$?
    kill "$watchdog_pid" 2>/dev/null || true
    wait "$watchdog_pid" 2>/dev/null || true

    # If killed by watchdog, the exit code is 137 (128+9) or similar
    if [[ $exit_code -ne 0 ]]; then
        # Check if the process was killed (timeout)
        if ! kill -0 "$cmd_pid" 2>/dev/null && [[ $exit_code -ge 128 ]]; then
            return 124
        fi
    fi
    return "$exit_code"
}

# Resolve agent command: CLI flag > config > default
# Sets AGENT_CMD_ARRAY (global)
resolve_agent_cmd() {
    local cmd=""

    # Priority 1: CLI flag
    if [[ -n "$AGENT_CMD_FLAG" ]]; then
        cmd="$AGENT_CMD_FLAG"
    fi

    # Priority 2: config.yaml settings.agent_cmd
    if [[ -z "$cmd" && -f "$TARGET_DIR/.accord/config.yaml" ]]; then
        local config_cmd
        config_cmd="$(yaml_setting "agent_cmd" "$TARGET_DIR/.accord/config.yaml")"
        if [[ -n "$config_cmd" ]]; then
            cmd="$config_cmd"
        fi
    fi

    # Priority 3: built-in default
    if [[ -z "$cmd" ]]; then
        cmd="$DEFAULT_AGENT_CMD"
    fi

    # Split into array for safe invocation
    AGENT_CMD_ARRAY=()
    read -ra AGENT_CMD_ARRAY <<< "$cmd"
}

# Build the prompt sent to the AI agent for a request
build_agent_prompt() {
    local req_file="$1"
    local service_name="$2"
    local req_content
    req_content="$(cat "$req_file")"
    local req_path
    req_path="$(basename "$req_file")"

    # Gather context: inline registry contents, list contract paths
    local context=""

    # Inline registry file contents (small files, ~20-40 lines each)
    if [[ -d "$TARGET_DIR/.accord/registry" ]]; then
        for f in "$TARGET_DIR/.accord/registry/"*.md; do
            if [[ -f "$f" ]]; then
                context="${context}
### Registry: $(basename "$f")
$(cat "$f")
"
            fi
        done
    fi

    # List contract files (OpenAPI can be large — just paths)
    local contract_list=""
    for f in "$TARGET_DIR/.accord/contracts/"*.yaml; do
        if [[ -f "$f" ]]; then
            contract_list="${contract_list}
  - .accord/contracts/$(basename "$f")"
        fi
    done
    for f in "$TARGET_DIR/.accord/contracts/internal/"*.md; do
        if [[ -f "$f" ]]; then
            contract_list="${contract_list}
  - .accord/contracts/internal/$(basename "$f")"
        fi
    done
    if [[ -n "$contract_list" ]]; then
        context="${context}
### Contract files (read as needed):${contract_list}
"
    fi

    local context_section=""
    if [[ -n "$context" ]]; then
        context_section="
## Service Context
${context}"
    fi

    cat <<PROMPT
You are running as a headless Accord agent for the "${service_name}" service.
Process the following request autonomously — no user confirmation needed.

## Request
Path: ${req_path}
${req_content}${context_section}

## Instructions
1. Implement the proposed changes in the codebase
2. Update the relevant contract file if needed (read from .accord/contracts/ if needed)
3. If the change requires work from another service, create a request in .accord/comms/inbox/{target}/
4. Set request status to 'completed', update timestamp
5. Move request to .accord/comms/archive/
6. Commit with: "accord(${service_name}): ${req_path%.md}"
7. Do NOT push — the daemon handles push
PROMPT
}

# Escalate a failure to the orchestrator inbox (if reachable)
escalate_to_orchestrator() {
    local req_file="$1"
    local reason="$2"

    local rid
    rid="$(req_field "id" "$req_file")"

    # Determine service name
    local service="accord-agent"
    if [[ -f "$TARGET_DIR/.accord/config.yaml" ]]; then
        local first_svc
        first_svc="$(yaml_all_services "$TARGET_DIR/.accord/config.yaml" | head -1 | xargs)"
        if [[ -n "$first_svc" ]]; then
            service="$first_svc"
        fi
    fi

    # Find orchestrator inbox: multi-repo hub or monorepo
    local orch_inbox=""
    if [[ -d "$TARGET_DIR/.accord/hub/comms/inbox/orchestrator" ]]; then
        orch_inbox="$TARGET_DIR/.accord/hub/comms/inbox/orchestrator"
    elif [[ -d "$TARGET_DIR/.accord/comms/inbox/orchestrator" ]]; then
        orch_inbox="$TARGET_DIR/.accord/comms/inbox/orchestrator"
    fi

    if [[ -z "$orch_inbox" ]]; then
        log_to_file "No orchestrator inbox found — skipping escalation for $rid"
        return 0
    fi

    local ts
    ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    local epoch
    epoch="$(date +%s)"
    local esc_id="req-escalation-${rid}-${epoch}"
    local esc_file="$orch_inbox/${esc_id}.md"

    cat > "$esc_file" <<ESCALATION
---
id: ${esc_id}
from: ${service}
to: orchestrator
scope: external
type: other
priority: high
status: pending
created: ${ts}
updated: ${ts}
originated_from: ${rid}
---

## What

Agent processing failed for request \`${rid}\`.

## Detail

- **Reason**: ${reason}
- **Request**: ${rid}
- **Location**: ${req_file}
- **Service**: ${service}

## Proposed Change

Manual review needed. The original request has been marked as \`failed\`.
ESCALATION

    log_to_file "Escalated failure to orchestrator: $esc_id (reason: $reason)"
}

# Process a non-command request via AI agent
process_with_agent() {
    local req_file="$1"
    local rid
    rid="$(req_field "id" "$req_file")"

    # Check attempt count
    local attempts
    attempts="$(req_field "attempts" "$req_file")"
    if [[ -z "$attempts" ]]; then
        attempts=0
    fi

    # Determine actor/service
    local actor="accord-agent"
    if [[ -f "$TARGET_DIR/.accord/config.yaml" ]]; then
        local first_svc
        first_svc="$(yaml_all_services "$TARGET_DIR/.accord/config.yaml" | head -1 | xargs)"
        if [[ -n "$first_svc" ]]; then
            actor="$first_svc"
        fi
    fi

    local history_script="$ACCORD_DIR/protocol/history/write-history.sh"
    local history_dir="$TARGET_DIR/.accord/comms/history"
    local archive_dir="$TARGET_DIR/.accord/comms/archive"
    mkdir -p "$archive_dir"

    log_to_file "Processing via agent: $rid (attempt $((attempts + 1))/$MAX_ATTEMPTS)"

    # Set status: in-progress
    local ts
    ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    sed "s/^status:[[:space:]]*.*/status: in-progress/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"
    sed "s/^updated:[[:space:]]*.*/updated: $ts/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"

    # Claim the task: commit + push so other agents see in-progress
    if git -C "$TARGET_DIR" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
        (cd "$TARGET_DIR" && git add -A && git commit -m "accord-agent: claim $rid" 2>/dev/null) || true
    fi
    do_sync_push

    # Build prompt
    local prompt
    prompt="$(build_agent_prompt "$req_file" "$actor")"

    # Invoke agent with timeout
    local agent_log
    agent_log="$(log_file).agent-${rid}"
    local exit_code=0
    run_with_timeout "$TIMEOUT" "${AGENT_CMD_ARRAY[@]}" "$prompt" > "$agent_log" 2>&1 || exit_code=$?

    if [[ $exit_code -eq 0 ]]; then
        # Success: check if agent already archived the request
        if [[ -f "$req_file" ]]; then
            # Agent didn't archive — daemon does it
            ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
            sed "s/^status:[[:space:]]*.*/status: completed/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"
            sed "s/^updated:[[:space:]]*.*/updated: $ts/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"
            local fname
            fname="$(basename "$req_file")"
            mv "$req_file" "$archive_dir/$fname"
        fi

        # Write history
        if [[ -f "$history_script" ]]; then
            bash "$history_script" \
                --history-dir "$history_dir" \
                --request-id "$rid" \
                --from-status "pending" \
                --to-status "completed" \
                --actor "$actor" \
                --detail "Processed by AI agent (accord-agent.sh)" 2>/dev/null || true
        fi

        log_to_file "Agent completed: $rid → archive"
    else
        # Failure or timeout
        local reason=""
        if [[ $exit_code -eq 124 ]]; then
            reason="timeout (${TIMEOUT}s)"
            warn "Agent timed out for: $rid (${TIMEOUT}s)"
            log_to_file "Agent timed out for: $rid (${TIMEOUT}s)"
        else
            reason="agent failure (exit $exit_code)"
            warn "Agent failed for: $rid (exit $exit_code)"
            log_to_file "Agent failed for: $rid (exit $exit_code)"
        fi

        # Increment attempt counter
        attempts=$((attempts + 1))

        if [[ -f "$req_file" ]]; then
            ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
            set_req_field "attempts" "$attempts" "$req_file"
            sed "s/^updated:[[:space:]]*.*/updated: $ts/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"

            if [[ $attempts -ge $MAX_ATTEMPTS ]]; then
                # Max attempts exhausted — mark as failed permanently
                sed "s/^status:[[:space:]]*.*/status: failed/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"
                log_to_file "Max attempts ($MAX_ATTEMPTS) reached for: $rid — status: failed"

                if [[ -f "$history_script" ]]; then
                    bash "$history_script" \
                        --history-dir "$history_dir" \
                        --request-id "$rid" \
                        --from-status "in-progress" \
                        --to-status "failed" \
                        --actor "$actor" \
                        --detail "$reason — max attempts ($MAX_ATTEMPTS) exhausted" 2>/dev/null || true
                fi

                escalate_to_orchestrator "$req_file" "$reason — max attempts ($MAX_ATTEMPTS) exhausted"
            else
                # Revert to pending for retry — no escalation yet
                sed "s/^status:[[:space:]]*.*/status: pending/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"

                if [[ -f "$history_script" ]]; then
                    bash "$history_script" \
                        --history-dir "$history_dir" \
                        --request-id "$rid" \
                        --from-status "in-progress" \
                        --to-status "pending" \
                        --actor "$actor" \
                        --detail "$reason — attempt $attempts/$MAX_ATTEMPTS, will retry" 2>/dev/null || true
                fi
            fi
        fi
    fi

    return $exit_code
}

# ── Core: Process Requests ──────────────────────────────────────────────────

# Processing is sequential per service — one request at a time.
# This avoids concurrency issues: the agent works in the same repo.
# Parallelism comes from running separate daemons per service (start-all).
process_requests() {
    local processed=0
    local history_script="$ACCORD_DIR/protocol/history/write-history.sh"

    # Determine history dir
    local history_dir="$TARGET_DIR/.accord/comms/history"
    local archive_dir="$TARGET_DIR/.accord/comms/archive"
    mkdir -p "$archive_dir"

    # Determine actor name from config
    local actor="accord-agent"
    if [[ -f "$TARGET_DIR/.accord/config.yaml" ]]; then
        local first_svc
        first_svc="$(yaml_all_services "$TARGET_DIR/.accord/config.yaml" | head -1 | xargs)"
        if [[ -n "$first_svc" ]]; then
            actor="$first_svc"
        fi
    fi

    for inbox_dir in "$TARGET_DIR/.accord/comms/inbox/"*/; do
        if [[ ! -d "$inbox_dir" ]]; then
            continue
        fi
        for req_file in "$inbox_dir"req-*.md; do
            if [[ ! -f "$req_file" ]]; then
                continue
            fi

            local rtype rstatus
            rtype="$(req_field "type" "$req_file")"
            rstatus="$(req_field "status" "$req_file")"

            if [[ "$rstatus" != "pending" ]]; then
                continue
            fi

            # Dispatch: command → shell fast-path, everything else → agent
            if [[ "$rtype" == "command" ]]; then
                # ── Shell fast-path (existing behavior) ──
                local rid rcmd
                rid="$(req_field "id" "$req_file")"
                rcmd="$(req_field "command" "$req_file")"

                log_to_file "Processing: $rid (command: $rcmd)"

                # Set status: in-progress
                local ts
                ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
                sed "s/^status:[[:space:]]*.*/status: in-progress/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"
                sed "s/^updated:[[:space:]]*.*/updated: $ts/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"

                # Execute command
                local result=""
                case "$rcmd" in
                    status)      result="$(exec_cmd_status)" ;;
                    scan)        result="$(exec_cmd_scan)" ;;
                    check-inbox) result="$(exec_cmd_check_inbox)" ;;
                    validate)    result="$(exec_cmd_validate)" ;;
                    *)           result="Unknown command: $rcmd" ;;
                esac

                # Append ## Result section
                printf "\n## Result\n\n%b\n\nExecuted by: accord-agent.sh at %s\n" "$result" "$ts" >> "$req_file"

                # Set status: completed
                ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
                sed "s/^status:[[:space:]]*.*/status: completed/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"
                sed "s/^updated:[[:space:]]*.*/updated: $ts/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"

                # Move to archive
                local fname
                fname="$(basename "$req_file")"
                mv "$req_file" "$archive_dir/$fname"

                # Write history entry
                if [[ -f "$history_script" ]]; then
                    bash "$history_script" \
                        --history-dir "$history_dir" \
                        --request-id "$rid" \
                        --from-status "pending" \
                        --to-status "completed" \
                        --actor "$actor" \
                        --detail "Auto-processed by accord-agent.sh (command: $rcmd)" 2>/dev/null || true
                fi

                processed=$((processed + 1))
                log_to_file "Completed: $rid → archive"
            else
                # ── Agent path (non-command requests) ──
                process_with_agent "$req_file" || true
                # Count as processed if the request was archived
                if [[ ! -f "$req_file" ]]; then
                    processed=$((processed + 1))
                fi
            fi
        done
    done

    echo "$processed"
}

# ── Tick Cycle ───────────────────────────────────────────────────────────────

do_tick() {
    resolve_agent_cmd
    do_sync_pull

    local count
    count="$(process_requests)"

    if [[ "$count" -gt 0 ]]; then
        # Commit changes
        if git -C "$TARGET_DIR" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
            (cd "$TARGET_DIR" && git add -A && git diff --cached --quiet) || \
                (cd "$TARGET_DIR" && git commit -m "accord-agent: process $count request(s)" 2>/dev/null) || true
        fi
        do_sync_push
        log_to_file "Tick: processed $count request(s)"
    else
        log_to_file "Tick: no requests to process"
    fi

    echo "$count"
}

# ── Subcommands ──────────────────────────────────────────────────────────────

do_start() {
    if is_running; then
        local pid
        pid="$(cat "$(pid_file)")"
        log "Already running (pid $pid)"
        exit 0
    fi

    resolve_agent_cmd
    log "Starting daemon (interval: ${INTERVAL}s, dir: $TARGET_DIR, agent: ${AGENT_CMD_ARRAY[*]})"

    # Fork background loop
    (
        trap 'exit 0' TERM
        while true; do
            do_tick > /dev/null 2>&1 || true
            sleep "$INTERVAL" &
            wait $! 2>/dev/null || exit 0
        done
    ) &

    local bg_pid=$!
    write_pid "$bg_pid"
    log_to_file "Daemon started (pid $bg_pid, interval ${INTERVAL}s)"
    log "Daemon started (pid $bg_pid)"
}

do_stop() {
    if ! is_running; then
        log "Not running"
        return 0
    fi

    local pid
    pid="$(cat "$(pid_file)")"
    kill "$pid" 2>/dev/null || true
    # Wait briefly for process to exit
    local i=0
    while kill -0 "$pid" 2>/dev/null && [[ $i -lt 10 ]]; do
        sleep 0.1
        i=$((i + 1))
    done
    remove_pid
    log_to_file "Daemon stopped (pid $pid)"
    log "Stopped (pid $pid)"
}

do_status() {
    if is_running; then
        local pid
        pid="$(cat "$(pid_file)")"
        log "Running (pid $pid)"

        # Show recent log
        local lf
        lf="$(log_file)"
        if [[ -f "$lf" ]]; then
            echo "Recent log:"
            tail -5 "$lf"
        fi
    else
        log "Not running"
    fi
}

do_run_once() {
    log "Run-once mode (dir: $TARGET_DIR)"
    resolve_agent_cmd
    do_sync_pull

    local count
    count="$(process_requests)"

    # Commit final state + push (matches do_tick flow)
    if git -C "$TARGET_DIR" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
        (cd "$TARGET_DIR" && git add -A && git diff --cached --quiet) || \
            (cd "$TARGET_DIR" && git commit -m "accord-agent: process request(s)" 2>/dev/null) || true
    fi
    do_sync_push
    log "Processed $count request(s)"
}

do_start_all() {
    # Read hub config.yaml → iterate services → find sibling dirs
    local config="$TARGET_DIR/config.yaml"
    if [[ ! -f "$config" ]]; then
        # Try .accord/config.yaml for monorepo
        config="$TARGET_DIR/.accord/config.yaml"
    fi
    if [[ ! -f "$config" ]]; then
        err "No config.yaml found in $TARGET_DIR or $TARGET_DIR/.accord/"
    fi

    local parent_dir
    parent_dir="$(dirname "$TARGET_DIR")"

    local started=0
    local skipped=0

    while IFS= read -r svc; do
        svc="$(echo "$svc" | xargs)"
        [[ -z "$svc" ]] && continue

        local svc_dir="$parent_dir/$svc"
        if [[ ! -d "$svc_dir/.accord" ]]; then
            warn "Service directory not found or not initialized: $svc_dir (skipping)"
            skipped=$((skipped + 1))
            continue
        fi

        log "Starting agent for: $svc"
        local extra_flags=()
        if [[ -n "$AGENT_CMD_FLAG" ]]; then
            extra_flags+=(--agent-cmd "$AGENT_CMD_FLAG")
        fi
        extra_flags+=(--timeout "$TIMEOUT")
        bash "$0" start --target-dir "$svc_dir" --interval "$INTERVAL" "${extra_flags[@]}"
        started=$((started + 1))
    done < <(yaml_all_services "$config")

    log "start-all complete: $started started, $skipped skipped"
}

do_stop_all() {
    local config="$TARGET_DIR/config.yaml"
    if [[ ! -f "$config" ]]; then
        config="$TARGET_DIR/.accord/config.yaml"
    fi
    if [[ ! -f "$config" ]]; then
        err "No config.yaml found in $TARGET_DIR or $TARGET_DIR/.accord/"
    fi

    local parent_dir
    parent_dir="$(dirname "$TARGET_DIR")"

    local stopped=0
    local skipped=0

    while IFS= read -r svc; do
        svc="$(echo "$svc" | xargs)"
        [[ -z "$svc" ]] && continue

        local svc_dir="$parent_dir/$svc"
        if [[ ! -d "$svc_dir/.accord" ]]; then
            warn "Service directory not found: $svc_dir (skipping)"
            skipped=$((skipped + 1))
            continue
        fi

        log "Stopping agent for: $svc"
        bash "$0" stop --target-dir "$svc_dir"
        stopped=$((stopped + 1))
    done < <(yaml_all_services "$config")

    log "stop-all complete: $stopped stopped, $skipped skipped"
}

do_status_all() {
    local config="$TARGET_DIR/config.yaml"
    if [[ ! -f "$config" ]]; then
        config="$TARGET_DIR/.accord/config.yaml"
    fi
    if [[ ! -f "$config" ]]; then
        err "No config.yaml found in $TARGET_DIR or $TARGET_DIR/.accord/"
    fi

    local parent_dir
    parent_dir="$(dirname "$TARGET_DIR")"

    local running=0
    local stopped=0
    local total=0

    echo ""
    echo "=== Agent Status (all services) ==="
    echo ""

    # Header
    printf "  %-20s %-10s %-8s  %s\n" "SERVICE" "STATUS" "PID" "LAST ACTIVITY"
    printf "  %-20s %-10s %-8s  %s\n" "───────────────────" "────────" "──────" "──────────────────────────────"

    while IFS= read -r svc; do
        svc="$(echo "$svc" | xargs)"
        [[ -z "$svc" ]] && continue
        total=$((total + 1))

        local svc_dir="$parent_dir/$svc"
        if [[ ! -d "$svc_dir/.accord" ]]; then
            printf "  %-20s %-10s %-8s  %s\n" "$svc" "NO_INIT" "-" "directory not initialized"
            stopped=$((stopped + 1))
            continue
        fi

        local pf="$svc_dir/.accord/.agent.pid"
        local svc_status="STOPPED"
        local pid_str="-"

        if [[ -f "$pf" ]]; then
            local pid
            pid="$(cat "$pf")"
            if kill -0 "$pid" 2>/dev/null; then
                svc_status="RUNNING"
                pid_str="$pid"
                running=$((running + 1))
            else
                # Stale PID
                rm -f "$pf"
                stopped=$((stopped + 1))
            fi
        else
            stopped=$((stopped + 1))
        fi

        # Get last activity from log
        local last_activity="-"
        local log_dir="$svc_dir/.accord/log"
        if [[ -d "$log_dir" ]]; then
            # Find newest agent log
            local newest_log
            newest_log="$(ls -t "$log_dir"/agent-*.log 2>/dev/null | head -1)"
            if [[ -n "$newest_log" && -f "$newest_log" ]]; then
                local last_line
                last_line="$(tail -1 "$newest_log" 2>/dev/null)"
                if [[ -n "$last_line" ]]; then
                    # Extract timestamp and message
                    local ts msg
                    ts="$(echo "$last_line" | sed -n 's/^\[accord-agent\] \([^ ]*\) .*/\1/p')"
                    msg="$(echo "$last_line" | sed 's/^\[accord-agent\] [^ ]* //')"
                    # Truncate message
                    if [[ ${#msg} -gt 45 ]]; then
                        msg="${msg:0:42}..."
                    fi
                    if [[ -n "$ts" ]]; then
                        last_activity="$ts $msg"
                    else
                        last_activity="$msg"
                    fi
                fi
            fi
        fi

        # Count pending requests
        local pending=0
        for f in "$svc_dir/.accord/comms/inbox/"*/req-*.md; do
            if [[ -f "$f" ]]; then
                local st
                st="$(sed -n '/^---$/,/^---$/{ s/^status:[[:space:]]*//p; }' "$f" | head -1 | xargs)"
                if [[ "$st" == "pending" || "$st" == "approved" ]]; then
                    pending=$((pending + 1))
                fi
            fi
        done

        local pending_info=""
        if [[ $pending -gt 0 ]]; then
            pending_info=" [${pending} pending]"
        fi

        # Color output
        local status_display="$svc_status"
        if [[ "$svc_status" == "RUNNING" ]]; then
            status_display=$'\033[0;32m'"RUNNING"$'\033[0m'
        elif [[ "$svc_status" == "STOPPED" ]]; then
            status_display=$'\033[0;31m'"STOPPED"$'\033[0m'
        fi

        printf "  %-20s %b  %-8s  %s%s\n" "$svc" "$status_display" "$pid_str" "$last_activity" "$pending_info"

    done < <(yaml_all_services "$config")

    echo ""
    echo "  Total: $total services — $running running, $stopped stopped"

    # Show hub-level request summary
    local hub_pending=0
    local hub_completed=0
    for inbox_dir in "$TARGET_DIR/comms/inbox/"*/; do
        if [[ ! -d "$inbox_dir" ]]; then continue; fi
        for f in "$inbox_dir"req-*.md; do
            if [[ ! -f "$f" ]]; then continue; fi
            local st
            st="$(sed -n '/^---$/,/^---$/{ s/^status:[[:space:]]*//p; }' "$f" | head -1 | xargs)"
            if [[ "$st" == "pending" || "$st" == "approved" || "$st" == "in-progress" ]]; then
                hub_pending=$((hub_pending + 1))
            fi
        done
    done
    for f in "$TARGET_DIR/comms/archive/"req-*.md; do
        if [[ -f "$f" ]]; then
            hub_completed=$((hub_completed + 1))
        fi
    done

    if [[ $hub_pending -gt 0 || $hub_completed -gt 0 ]]; then
        echo "  Hub requests: $hub_pending active, $hub_completed archived"
    fi
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    parse_args "$@"

    TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

    case "$SUBCOMMAND" in
        start)      do_start ;;
        stop)       do_stop ;;
        status)     do_status ;;
        run-once)   do_run_once ;;
        start-all)  do_start_all ;;
        stop-all)   do_stop_all ;;
        status-all) do_status_all ;;
    esac
}

main "$@"
