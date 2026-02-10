#!/usr/bin/env bash
# Accord Log — read and serve debug logs
#
# Default: read .accord/log/ and print a CLI summary (sessions, recent entries).
# With --serve: copy viewer, generate manifest, start HTTP server.
#
# Usage:
#   ~/.accord/accord-log.sh                    # CLI summary of .accord/log/
#   ~/.accord/accord-log.sh --tail 20          # Show last 20 entries
#   ~/.accord/accord-log.sh --session <id>     # Show entries for a specific session
#   ~/.accord/accord-log.sh --serve            # Launch web viewer
#   ~/.accord/accord-log.sh --serve --port 9000

set -euo pipefail

ACCORD_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────

TARGET_DIR="."
MODE="summary"
PORT=8420
OPEN_BROWSER=true
TAIL_COUNT=10
SESSION_FILTER=""

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# Category colors (for terminal)
color_for() {
    case "$1" in
        lifecycle) echo "$CYAN" ;;
        comms)     echo "$GREEN" ;;
        contract)  echo "\033[0;35m" ;;
        git)       echo "$YELLOW" ;;
        scan)      echo "\033[0;36m" ;;
        config)    echo "$DIM" ;;
        *)         echo "$NC" ;;
    esac
}

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo -e "[accord-log] $*"; }
err() { echo -e "[accord-log] ERROR: $*" >&2; exit 1; }

# ── Argument Parsing ─────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target-dir) TARGET_DIR="$2"; shift 2 ;;
        --serve)      MODE="serve"; shift ;;
        --port)       PORT="$2"; shift 2 ;;
        --no-open)    OPEN_BROWSER=false; shift ;;
        --tail)       TAIL_COUNT="$2"; MODE="tail"; shift 2 ;;
        --session)    SESSION_FILTER="$2"; MODE="session"; shift 2 ;;
        --help)
            cat <<'HELP'
Usage: accord-log.sh [OPTIONS]

Read and display Accord debug logs from .accord/log/.

Modes:
  (default)           Show session list and recent entries
  --tail <N>          Show the last N log entries across all sessions
  --session <id>      Show all entries for a specific session
  --serve             Launch web-based timeline viewer

Options:
  --target-dir <path>   Project directory (default: current directory)
  --port <port>         HTTP server port for --serve (default: 8420)
  --no-open             Don't open browser on --serve
  --help                Show this help

Examples:
  ~/.accord/accord-log.sh                       # Summary
  ~/.accord/accord-log.sh --tail 30             # Last 30 entries
  ~/.accord/accord-log.sh --session 2026-02-10T14-30-00_device-manager
  ~/.accord/accord-log.sh --serve               # Web viewer
HELP
            exit 0
            ;;
        *) err "Unknown option: $1. Use --help for usage." ;;
    esac
done

TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"
LOG_DIR="$TARGET_DIR/.accord/log"

# ── Validate ─────────────────────────────────────────────────────────────────

if [[ ! -d "$TARGET_DIR/.accord" ]]; then
    err "No .accord/ directory found in $TARGET_DIR — is this an Accord project?"
fi

if [[ ! -d "$LOG_DIR" ]]; then
    mkdir -p "$LOG_DIR"
fi

# ── Check debug status ───────────────────────────────────────────────────────

check_debug_status() {
    local config="$TARGET_DIR/.accord/config.yaml"
    if [[ -f "$config" ]] && grep -q "debug: true" "$config" 2>/dev/null; then
        echo -e "  Debug logging: ${GREEN}ENABLED${NC}"
    else
        echo -e "  Debug logging: ${DIM}DISABLED${NC} ${DIM}(set debug: true in .accord/config.yaml)${NC}"
    fi
}

# ── Collect log files (sorted by name = by time) ─────────────────────────────

collect_log_files() {
    local files=()
    for f in "$LOG_DIR"/*.jsonl; do
        [[ -f "$f" ]] || continue
        files+=("$f")
    done
    # Sort (filenames are timestamps, so lexicographic = chronological)
    IFS=$'\n' SORTED=($(printf '%s\n' "${files[@]+"${files[@]}"}" | sort)); unset IFS
    echo "${SORTED[@]+"${SORTED[@]}"}"
}

# ── CLI Summary Mode ─────────────────────────────────────────────────────────

show_summary() {
    echo ""
    echo -e "${BOLD}=== Accord Debug Logs ===${NC}"
    echo ""
    check_debug_status
    echo -e "  Log directory: ${DIM}$LOG_DIR${NC}"
    echo ""

    local log_files
    log_files=($(collect_log_files))

    if [[ ${#log_files[@]} -eq 0 ]]; then
        echo -e "  ${DIM}No log files found.${NC}"
        echo ""
        return
    fi

    # Session table
    echo -e "  ${BOLD}Sessions:${NC}"
    printf "  %-42s %-18s %8s  %s\n" "Session" "Module" "Entries" "Time Range"
    printf "  %-42s %-18s %8s  %s\n" "-------" "------" "-------" "----------"

    for f in "${log_files[@]}"; do
        local fname
        fname="$(basename "$f" .jsonl)"
        local entry_count
        entry_count="$(wc -l < "$f" | xargs)"

        # Extract module from filename (after last _)
        local module="${fname##*_}"

        # Get first and last timestamps
        local first_ts last_ts
        first_ts="$(head -1 "$f" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ts','?')[:19])" 2>/dev/null || echo "?")"
        last_ts="$(tail -1 "$f" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ts','?')[:19])" 2>/dev/null || echo "?")"

        # Format time range
        local range=""
        if [[ "$first_ts" != "?" && "$last_ts" != "?" ]]; then
            range="${first_ts##*T} → ${last_ts##*T}"
        fi

        printf "  %-42s %-18s %8s  %s\n" "$fname" "$module" "$entry_count" "$range"
    done

    echo ""

    # Show recent entries from the latest session
    local latest="${log_files[${#log_files[@]}-1]}"
    local latest_name
    latest_name="$(basename "$latest" .jsonl)"
    local recent_count=10
    local total_lines
    total_lines="$(wc -l < "$latest" | xargs)"

    echo -e "  ${BOLD}Recent entries${NC} ${DIM}(${latest_name}, last $recent_count of $total_lines):${NC}"
    echo ""

    tail -"$recent_count" "$latest" | while IFS= read -r line; do
        print_entry "$line"
    done

    echo ""
    echo -e "  ${DIM}Use --tail <N> for more entries, --serve for web viewer${NC}"
    echo ""
}

# ── Tail Mode ─────────────────────────────────────────────────────────────────

show_tail() {
    echo ""
    echo -e "${BOLD}=== Accord Debug Logs — last $TAIL_COUNT entries ===${NC}"
    echo ""

    local log_files
    log_files=($(collect_log_files))

    if [[ ${#log_files[@]} -eq 0 ]]; then
        echo -e "  ${DIM}No log files found.${NC}"
        echo ""
        return
    fi

    # Merge all files, sort by timestamp, take last N
    # (files are already per-session sorted, so we cat + sort)
    local all_entries
    all_entries="$(cat "${log_files[@]}" | python3 -c "
import sys, json
lines = []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        obj = json.loads(line)
        lines.append((obj.get('ts',''), line))
    except: pass
lines.sort(key=lambda x: x[0])
for _, l in lines[-${TAIL_COUNT}:]:
    print(l)
" 2>/dev/null)"

    if [[ -z "$all_entries" ]]; then
        echo -e "  ${DIM}No entries found.${NC}"
        echo ""
        return
    fi

    echo "$all_entries" | while IFS= read -r line; do
        print_entry "$line"
    done
    echo ""
}

# ── Session Mode ──────────────────────────────────────────────────────────────

show_session() {
    echo ""
    echo -e "${BOLD}=== Accord Debug Logs — session: $SESSION_FILTER ===${NC}"
    echo ""

    local target_file="$LOG_DIR/${SESSION_FILTER}.jsonl"

    if [[ ! -f "$target_file" ]]; then
        # Try partial match
        local matches=()
        for f in "$LOG_DIR"/*"${SESSION_FILTER}"*.jsonl; do
            [[ -f "$f" ]] && matches+=("$f")
        done
        if [[ ${#matches[@]} -eq 0 ]]; then
            err "No log file found matching '$SESSION_FILTER'"
        elif [[ ${#matches[@]} -gt 1 ]]; then
            echo "  Multiple matches:"
            for m in "${matches[@]}"; do
                echo "    $(basename "$m" .jsonl)"
            done
            echo ""
            err "Be more specific."
        fi
        target_file="${matches[0]}"
    fi

    local fname
    fname="$(basename "$target_file" .jsonl)"
    local entry_count
    entry_count="$(wc -l < "$target_file" | xargs)"

    echo -e "  File: ${DIM}$target_file${NC}"
    echo -e "  Entries: ${GREEN}$entry_count${NC}"
    echo ""

    # Category breakdown
    echo -e "  ${BOLD}By category:${NC}"
    python3 -c "
import sys, json
from collections import Counter
cats = Counter()
for line in open('$target_file'):
    line = line.strip()
    if not line: continue
    try:
        obj = json.loads(line)
        cats[obj.get('category','?')] += 1
    except: pass
for cat, count in sorted(cats.items()):
    print(f'    {cat:<12} {count}')
" 2>/dev/null || true

    echo ""
    echo -e "  ${BOLD}All entries:${NC}"
    echo ""

    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        print_entry "$line"
    done < "$target_file"

    echo ""
}

# ── Print a single log entry ─────────────────────────────────────────────────

print_entry() {
    local line="$1"
    local ts action category detail request_id status_from status_to module
    # Parse with python3 for reliable JSON handling
    eval "$(echo "$line" | python3 -c "
import sys, json, shlex
try:
    d = json.loads(sys.stdin.read())
    print(f'ts={shlex.quote(d.get(\"ts\",\"?\")[:19])}')
    print(f'action={shlex.quote(d.get(\"action\",\"?\"))}')
    print(f'category={shlex.quote(d.get(\"category\",\"?\"))}')
    print(f'detail={shlex.quote(d.get(\"detail\",\"\"))}')
    print(f'request_id={shlex.quote(d.get(\"request_id\",\"\"))}')
    print(f'status_from={shlex.quote(d.get(\"status_from\",\"\"))}')
    print(f'status_to={shlex.quote(d.get(\"status_to\",\"\"))}')
    print(f'module={shlex.quote(d.get(\"module\",\"?\"))}')
except:
    print('ts=\"?\"')
    print('action=\"?\"')
    print('category=\"?\"')
    print('detail=\"\"')
    print('request_id=\"\"')
    print('status_from=\"\"')
    print('status_to=\"\"')
    print('module=\"?\"')
" 2>/dev/null)" || return

    local time_part="${ts##*T}"
    [[ "$time_part" == "$ts" ]] && time_part="$ts"

    local clr
    clr="$(color_for "$category")"

    local extra=""
    if [[ -n "$request_id" ]]; then
        extra=" [$request_id]"
    fi
    if [[ -n "$status_from" && -n "$status_to" ]]; then
        extra="$extra ($status_from → $status_to)"
    fi

    echo -e "  ${DIM}${time_part}${NC}  ${clr}$(printf '%-10s' "$category")${NC} $(printf '%-20s' "$action") ${detail}${DIM}${extra}${NC}"
}

# ── Serve Mode ────────────────────────────────────────────────────────────────

serve_viewer() {
    # Copy viewer
    local viewer_src="$ACCORD_DIR/protocol/debug/viewer.html"
    if [[ ! -f "$viewer_src" ]]; then
        err "Viewer not found at $viewer_src"
    fi
    cp "$viewer_src" "$LOG_DIR/index.html"

    # Generate manifest
    generate_manifest() {
        local manifest="$LOG_DIR/manifest.json"
        local files=""
        local count=0
        for f in "$LOG_DIR"/*.jsonl; do
            [[ -f "$f" ]] || continue
            local name
            name="$(basename "$f")"
            if [[ -n "$files" ]]; then
                files="$files,\"$name\""
            else
                files="\"$name\""
            fi
            count=$((count + 1))
        done
        local now
        now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        echo "{\"files\":[$files],\"generated\":\"$now\"}" > "$manifest"
        echo "$count"
    }

    local file_count
    file_count="$(generate_manifest)"

    echo ""
    echo -e "${BOLD}=== Accord Log Viewer ===${NC}"
    echo ""
    check_debug_status
    echo -e "  Log files:  ${GREEN}$file_count${NC}"
    echo -e "  Serving:    ${GREEN}http://localhost:$PORT${NC}"
    echo -e "  Directory:  ${DIM}$LOG_DIR${NC}"
    echo ""
    echo -e "  ${DIM}Press Ctrl+C to stop${NC}"
    echo ""

    # Open browser
    if [[ "$OPEN_BROWSER" == true ]]; then
        if command -v open >/dev/null 2>&1; then
            open "http://localhost:$PORT" 2>/dev/null &
        elif command -v xdg-open >/dev/null 2>&1; then
            xdg-open "http://localhost:$PORT" 2>/dev/null &
        fi
    fi

    # Regenerate manifest periodically
    (
        while true; do
            sleep 5
            generate_manifest > /dev/null 2>&1
        done
    ) &
    local manifest_pid=$!
    trap "kill $manifest_pid 2>/dev/null; exit 0" INT TERM

    # Start HTTP server
    cd "$LOG_DIR"
    if command -v python3 >/dev/null 2>&1; then
        python3 -m http.server "$PORT" 2>/dev/null
    elif command -v python >/dev/null 2>&1; then
        python -m http.server "$PORT" 2>/dev/null
    else
        err "Python not found — needed for HTTP server"
    fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

case "$MODE" in
    summary) show_summary ;;
    tail)    show_tail ;;
    session) show_session ;;
    serve)   serve_viewer ;;
esac
