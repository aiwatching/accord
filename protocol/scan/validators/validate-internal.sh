#!/usr/bin/env bash
# Validates that an internal contract file meets Accord format requirements.
#
# Usage: validate-internal.sh <path-to-md>
# Exit 0 = valid, Exit 1 = invalid

set -euo pipefail

FILE="$1"

if [[ ! -f "$FILE" ]]; then
    echo "Error: File not found: $FILE"
    exit 1
fi

ERRORS=0

# Check: has YAML frontmatter (starts with ---)
if ! head -1 "$FILE" | grep -q "^---"; then
    echo "  FAIL: Missing YAML frontmatter (no opening ---)"
    ((ERRORS++))
fi

# Check: required frontmatter fields
for field in "id:" "module:" "language:" "type:" "status:"; do
    if ! grep -q "$field" "$FILE"; then
        echo "  FAIL: Missing required frontmatter field: $field"
        ((ERRORS++))
    fi
done

# Check: has ## Interface section
if ! grep -q "^## Interface" "$FILE"; then
    echo "  FAIL: Missing '## Interface' section"
    ((ERRORS++))
fi

# Check: has a code block (``` followed by language)
if ! grep -q '```' "$FILE"; then
    echo "  FAIL: No code block found in Interface section"
    ((ERRORS++))
fi

# Check: has ## Behavioral Contract section
if ! grep -q "^## Behavioral Contract" "$FILE"; then
    echo "  FAIL: Missing '## Behavioral Contract' section"
    ((ERRORS++))
fi

# Check: has ## Used By section
if ! grep -q "^## Used By" "$FILE"; then
    echo "  FAIL: Missing '## Used By' section"
    ((ERRORS++))
fi

if [[ $ERRORS -gt 0 ]]; then
    exit 1
fi

exit 0
