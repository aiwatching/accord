#!/usr/bin/env bash
# accord-cascade — Create parent-child request relationships
#
# Creates child requests linked to a parent, enabling cascading workflows
# where a parent request fans out to multiple services.
#
# Usage:
#   accord-cascade.sh create --parent <req-id> --to <svc1,svc2> --team-dir <path> \
#     [--body "request body"] [--type <type>] [--priority <priority>] [--from <service>]
#
# The parent request's child_requests field is updated.
# Each child has parent_request set.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────

SUBCOMMAND=""
PARENT_ID=""
TO_SERVICES=""
TEAM_DIR=""
BODY=""
REQ_TYPE="other"
PRIORITY="medium"
FROM_SERVICE="orchestrator"

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo "[accord-cascade] $*"; }
warn() { echo "[accord-cascade] WARNING: $*" >&2; }
err() { echo "[accord-cascade] ERROR: $*" >&2; exit 1; }

usage() {
    cat <<'HELP'
Usage: accord-cascade.sh create [options]

Creates child requests linked to a parent request.

Options:
  --parent <req-id>       Parent request ID (required)
  --to <svc1,svc2>        Target services, comma-separated (required)
  --team-dir <path>       Team directory in hub (required)
  --body "text"           Request body (optional)
  --type <type>           Request type (default: other)
  --priority <priority>   Priority: low|medium|high|critical (default: medium)
  --from <service>        Originating service (default: orchestrator)
  --help                  Show this help message
HELP
}

# ── Argument Parsing ─────────────────────────────────────────────────────────

parse_args() {
    if [[ $# -eq 0 ]]; then
        usage
        exit 1
    fi

    SUBCOMMAND="$1"; shift

    case "$SUBCOMMAND" in
        create) ;;
        --help|-h) usage; exit 0 ;;
        *) err "Unknown command: $SUBCOMMAND. Use 'create'." ;;
    esac

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --parent)   PARENT_ID="$2"; shift 2 ;;
            --to)       TO_SERVICES="$2"; shift 2 ;;
            --team-dir) TEAM_DIR="$2"; shift 2 ;;
            --body)     BODY="$2"; shift 2 ;;
            --type)     REQ_TYPE="$2"; shift 2 ;;
            --priority) PRIORITY="$2"; shift 2 ;;
            --from)     FROM_SERVICE="$2"; shift 2 ;;
            --help)     usage; exit 0 ;;
            *)          err "Unknown option: $1" ;;
        esac
    done

    if [[ -z "$PARENT_ID" ]]; then
        err "--parent is required"
    fi
    if [[ -z "$TO_SERVICES" ]]; then
        err "--to is required"
    fi
    if [[ -z "$TEAM_DIR" ]]; then
        err "--team-dir is required"
    fi
}

# ── Create Cascade ──────────────────────────────────────────────────────────

do_create() {
    local ts
    ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

    local child_ids=()
    local seq=1

    IFS=',' read -ra targets <<< "$TO_SERVICES"
    for target in "${targets[@]}"; do
        target="$(echo "$target" | xargs)"
        if [[ -z "$target" ]]; then continue; fi

        local child_id="req-cascade-${PARENT_ID#req-}-${seq}"
        local inbox_dir="$TEAM_DIR/comms/inbox/$target"
        mkdir -p "$inbox_dir"

        local child_file="$inbox_dir/${child_id}.md"

        local body_section="${BODY:-Cascaded from parent request: $PARENT_ID}"

        cat > "$child_file" <<EOF
---
id: $child_id
from: $FROM_SERVICE
to: $target
scope: external
type: $REQ_TYPE
priority: $PRIORITY
status: pending
created: $ts
updated: $ts
parent_request: $PARENT_ID
---

## What

$body_section

## Proposed Change

Implement the changes described above for the **$target** service.

## Why

Part of cascaded request from **$PARENT_ID**.

## Impact

Check the parent request for full context.
EOF

        log "Created child request: $child_id → $target"
        child_ids+=("$child_id")
        seq=$((seq + 1))
    done

    # Update parent request with child_requests list
    # Find the parent request file
    local parent_file=""
    for inbox_dir in "$TEAM_DIR"/comms/inbox/*/; do
        if [[ -d "$inbox_dir" ]]; then
            for f in "$inbox_dir"*.md; do
                if [[ -f "$f" ]] && grep -q "^id: $PARENT_ID" "$f" 2>/dev/null; then
                    parent_file="$f"
                    break 2
                fi
            done
        fi
    done
    # Also check archive
    if [[ -z "$parent_file" ]]; then
        for f in "$TEAM_DIR"/comms/archive/*.md; do
            if [[ -f "$f" ]] && grep -q "^id: $PARENT_ID" "$f" 2>/dev/null; then
                parent_file="$f"
                break
            fi
        done
    fi

    if [[ -n "$parent_file" ]]; then
        # Add child_requests field to parent's frontmatter
        local children_yaml
        children_yaml="$(printf '  - %s\n' "${child_ids[@]}")"

        # Check if child_requests already exists
        if grep -q "^child_requests:" "$parent_file" 2>/dev/null; then
            # Append to existing list
            local tmp_file
            tmp_file="$(mktemp)"
            awk -v children="$children_yaml" '
                /^child_requests:/ { print; found=1; next }
                found && /^[^ ]/ { printf "%s\n", children; found=0 }
                { print }
                END { if (found) printf "%s\n", children }
            ' "$parent_file" > "$tmp_file"
            mv "$tmp_file" "$parent_file"
        else
            # Insert child_requests before the closing ---
            local tmp_file
            tmp_file="$(mktemp)"
            local in_frontmatter=false
            local inserted=false
            while IFS= read -r line; do
                if [[ "$line" == "---" && "$in_frontmatter" == false ]]; then
                    in_frontmatter=true
                    echo "$line" >> "$tmp_file"
                elif [[ "$line" == "---" && "$in_frontmatter" == true && "$inserted" == false ]]; then
                    echo "child_requests:" >> "$tmp_file"
                    printf '%s\n' "${child_ids[@]}" | while read -r cid; do
                        echo "  - $cid" >> "$tmp_file"
                    done
                    echo "$line" >> "$tmp_file"
                    inserted=true
                    in_frontmatter=false
                else
                    echo "$line" >> "$tmp_file"
                fi
            done < "$parent_file"
            mv "$tmp_file" "$parent_file"
        fi
        log "Updated parent request $PARENT_ID with ${#child_ids[@]} child reference(s)"
    else
        warn "Parent request file not found for $PARENT_ID — child_requests not linked"
    fi

    log "Cascade complete: ${#child_ids[@]} child request(s) created"
}

# ── Main ─────────────────────────────────────────────────────────────────────

parse_args "$@"

case "$SUBCOMMAND" in
    create) do_create ;;
esac
