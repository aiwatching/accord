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
  start      Start the daemon (background)
  stop       Stop the daemon
  status     Show daemon status
  run-once   Process requests once, then exit
  start-all  Start daemons for all services (from hub)
  stop-all   Stop daemons for all services (from hub)

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

# ── Argument Parsing ─────────────────────────────────────────────────────────

parse_args() {
    [[ $# -eq 0 ]] && { usage; exit 0; }

    SUBCOMMAND="$1"; shift

    case "$SUBCOMMAND" in
        start|stop|status|run-once|start-all|stop-all) ;;
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
        (cd "$TARGET_DIR" && git add -A && git diff --cached --quiet || git commit -m "accord-agent: process commands" && git push 2>/dev/null) || log_to_file "Git push failed"
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

    cat <<PROMPT
You are running as a headless Accord agent for the "${service_name}" service.
Process the following request autonomously — no user confirmation needed.

## Request
Path: ${req_path}
${req_content}

## Instructions
1. Implement the proposed changes in the codebase
2. Update the relevant contract file if needed
3. Set request status to 'completed', update timestamp
4. Move request to .accord/comms/archive/
5. Commit with: "accord(${service_name}): ${req_path%.md}"
6. Do NOT push — the daemon handles push
PROMPT
}

# Process a non-command request via AI agent
process_with_agent() {
    local req_file="$1"
    local rid rcmd_status
    rid="$(req_field "id" "$req_file")"

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

    log "Processing via agent: $rid"
    log_to_file "Processing via agent: $rid"

    # Auto-approve: pending → approved → in-progress
    local ts
    ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    sed "s/^status:[[:space:]]*.*/status: in-progress/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"
    sed "s/^updated:[[:space:]]*.*/updated: $ts/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"

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

        log "Agent completed: $rid"
        log_to_file "Agent completed: $rid → archive"
    elif [[ $exit_code -eq 124 ]]; then
        # Timeout: revert to pending
        warn "Agent timed out for: $rid (${TIMEOUT}s)"
        log_to_file "Agent timed out for: $rid (${TIMEOUT}s)"
        if [[ -f "$req_file" ]]; then
            ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
            sed "s/^status:[[:space:]]*.*/status: pending/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"
            sed "s/^updated:[[:space:]]*.*/updated: $ts/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"
        fi

        if [[ -f "$history_script" ]]; then
            bash "$history_script" \
                --history-dir "$history_dir" \
                --request-id "$rid" \
                --from-status "in-progress" \
                --to-status "pending" \
                --actor "$actor" \
                --detail "Agent timed out (${TIMEOUT}s), reverted to pending" 2>/dev/null || true
        fi
    else
        # Failure: revert to pending
        warn "Agent failed for: $rid (exit $exit_code)"
        log_to_file "Agent failed for: $rid (exit $exit_code)"
        if [[ -f "$req_file" ]]; then
            ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
            sed "s/^status:[[:space:]]*.*/status: pending/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"
            sed "s/^updated:[[:space:]]*.*/updated: $ts/" "$req_file" > "$req_file.tmp" && mv "$req_file.tmp" "$req_file"
        fi

        if [[ -f "$history_script" ]]; then
            bash "$history_script" \
                --history-dir "$history_dir" \
                --request-id "$rid" \
                --from-status "in-progress" \
                --to-status "pending" \
                --actor "$actor" \
                --detail "Agent failed (exit $exit_code), reverted to pending" 2>/dev/null || true
        fi
    fi

    return $exit_code
}

# ── Core: Process Requests ──────────────────────────────────────────────────

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

                log "Processing: $rid (command: $rcmd)"
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
                log "Completed: $rid"
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
    local count
    count="$(process_requests)"
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
        bash "$0" start --target-dir "$svc_dir" --interval "$INTERVAL"
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

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    parse_args "$@"

    TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

    case "$SUBCOMMAND" in
        start)     do_start ;;
        stop)      do_stop ;;
        status)    do_status ;;
        run-once)  do_run_once ;;
        start-all) do_start_all ;;
        stop-all)  do_stop_all ;;
    esac
}

main "$@"
