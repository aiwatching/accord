#!/usr/bin/env bash
# Validates that a request file meets Accord format requirements.
#
# Usage: validate-request.sh <path-to-md>
# Exit 0 = valid, Exit 1 = invalid

set -euo pipefail

FILE="$1"

if [[ ! -f "$FILE" ]]; then
    echo "Error: File not found: $FILE"
    exit 1
fi

ERRORS=0
WARNINGS=0

# Check: has YAML frontmatter (starts with ---)
if ! head -1 "$FILE" | grep -q "^---"; then
    echo "  FAIL: Missing YAML frontmatter (no opening ---)"
    ERRORS=$((ERRORS + 1))
fi

# Check: required frontmatter fields
for field in "id:" "from:" "to:" "scope:" "type:" "priority:" "status:" "created:" "updated:"; do
    if ! grep -q "$field" "$FILE"; then
        echo "  FAIL: Missing required frontmatter field: $field"
        ERRORS=$((ERRORS + 1))
    fi
done

# Check: id format (req-NNN-description)
if grep -q "^id:" "$FILE"; then
    id_value=$(grep "^id:" "$FILE" | head -1 | sed 's/^id:[[:space:]]*//')
    if ! echo "$id_value" | grep -qE "^req-[0-9]+-[a-z0-9-]+$"; then
        echo "  WARN: ID '$id_value' does not match pattern req-{NNN}-{description}"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

# Check: scope is valid
if grep -q "^scope:" "$FILE"; then
    scope_value=$(grep "^scope:" "$FILE" | head -1 | sed 's/^scope:[[:space:]]*//')
    case "$scope_value" in
        external|internal) ;;
        *) echo "  FAIL: Invalid scope: $scope_value (must be external or internal)"; ERRORS=$((ERRORS + 1)) ;;
    esac
fi

# Check: status is valid
if grep -q "^status:" "$FILE"; then
    status_value=$(grep "^status:" "$FILE" | head -1 | sed 's/^status:[[:space:]]*//')
    case "$status_value" in
        pending|approved|rejected|in-progress|completed) ;;
        *) echo "  FAIL: Invalid status: $status_value"; ERRORS=$((ERRORS + 1)) ;;
    esac
fi

# Check: priority is valid
if grep -q "^priority:" "$FILE"; then
    priority_value=$(grep "^priority:" "$FILE" | head -1 | sed 's/^priority:[[:space:]]*//')
    case "$priority_value" in
        low|medium|high|critical) ;;
        *) echo "  FAIL: Invalid priority: $priority_value"; ERRORS=$((ERRORS + 1)) ;;
    esac
fi

# Check: type is valid
if grep -q "^type:" "$FILE"; then
    type_value=$(grep "^type:" "$FILE" | head -1 | sed 's/^type:[[:space:]]*//')
    case "$type_value" in
        api-addition|api-change|api-deprecation) ;;
        interface-addition|interface-change|interface-deprecation) ;;
        bug-report|question|other) ;;
        command) ;;
        *) echo "  WARN: Non-standard request type: $type_value"; WARNINGS=$((WARNINGS + 1)) ;;
    esac
fi

# Check: command type requires command field
if grep -q "^type: command" "$FILE"; then
    if grep -q "^command:" "$FILE"; then
        cmd_value=$(grep "^command:" "$FILE" | head -1 | sed 's/^command:[[:space:]]*//')
        case "$cmd_value" in
            status|scan|check-inbox|validate) ;;
            *) echo "  WARN: Non-standard command: $cmd_value (expected: status, scan, check-inbox, validate)"; WARNINGS=$((WARNINGS + 1)) ;;
        esac
    else
        echo "  FAIL: type: command requires a 'command:' field"
        ERRORS=$((ERRORS + 1))
    fi
fi

# Check: has ## What section
if ! grep -q "^## What" "$FILE"; then
    echo "  FAIL: Missing '## What' section"
    ERRORS=$((ERRORS + 1))
fi

# Check: has ## Proposed Change section
if ! grep -q "^## Proposed Change" "$FILE"; then
    echo "  WARN: Missing '## Proposed Change' section"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: has ## Why section
if ! grep -q "^## Why" "$FILE"; then
    echo "  WARN: Missing '## Why' section"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: rejected requests should have a Rejection Reason
if grep -q "^status: rejected" "$FILE"; then
    if ! grep -q "^## Rejection Reason" "$FILE"; then
        echo "  FAIL: Rejected request missing '## Rejection Reason' section"
        ERRORS=$((ERRORS + 1))
    fi
fi

if [[ $WARNINGS -gt 0 && $ERRORS -eq 0 ]]; then
    echo "  $WARNINGS warning(s)"
fi

if [[ $ERRORS -gt 0 ]]; then
    exit 1
fi

exit 0
