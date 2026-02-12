#!/usr/bin/env bash
# Validates that a directive file meets Accord v2 format requirements.
#
# Usage: validate-directive.sh <path-to-md>
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
for field in "id:" "title:" "priority:" "status:" "created:" "updated:" "requests:"; do
    if ! grep -q "$field" "$FILE"; then
        echo "  FAIL: Missing required frontmatter field: $field"
        ERRORS=$((ERRORS + 1))
    fi
done

# Check: id format (dir-NNN-description)
if grep -q "^id:" "$FILE"; then
    id_value=$(grep "^id:" "$FILE" | head -1 | sed 's/^id:[[:space:]]*//')
    if ! echo "$id_value" | grep -qE "^dir-[0-9]+-[a-z0-9-]+$"; then
        echo "  WARN: ID '$id_value' does not match pattern dir-{NNN}-{description}"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

# Check: status is valid
if grep -q "^status:" "$FILE"; then
    status_value=$(grep "^status:" "$FILE" | head -1 | sed 's/^status:[[:space:]]*//')
    case "$status_value" in
        pending|in-progress|completed|failed) ;;
        *) echo "  FAIL: Invalid status: $status_value (must be pending, in-progress, completed, or failed)"; ERRORS=$((ERRORS + 1)) ;;
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

# Check: has ## Requirement section
if ! grep -q "^## Requirement" "$FILE"; then
    echo "  FAIL: Missing '## Requirement' section"
    ERRORS=$((ERRORS + 1))
fi

# Check: has ## Acceptance Criteria section
if ! grep -q "^## Acceptance Criteria" "$FILE"; then
    echo "  WARN: Missing '## Acceptance Criteria' section"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: has ## Decomposition section
if ! grep -q "^## Decomposition" "$FILE"; then
    echo "  WARN: Missing '## Decomposition' section"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: failed directives should have context
if grep -q "^status: failed" "$FILE"; then
    if ! grep -q "^## Failure Reason" "$FILE"; then
        echo "  WARN: Failed directive missing '## Failure Reason' section"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

if [[ $WARNINGS -gt 0 && $ERRORS -eq 0 ]]; then
    echo "  $WARNINGS warning(s)"
fi

if [[ $ERRORS -gt 0 ]]; then
    exit 1
fi

exit 0
