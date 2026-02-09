#!/usr/bin/env bash
# Validates that a generated OpenAPI contract meets Accord requirements.
# This is a lightweight check — not a full OpenAPI spec validator.
#
# Usage: validate-openapi.sh <path-to-yaml>
# Exit 0 = valid, Exit 1 = invalid

set -euo pipefail

FILE="$1"

if [[ ! -f "$FILE" ]]; then
    echo "Error: File not found: $FILE"
    exit 1
fi

ERRORS=0

# Check: file is valid YAML (basic check — looks for openapi key)
if ! grep -q "^openapi:" "$FILE"; then
    echo "  FAIL: Missing 'openapi:' top-level key"
    ((ERRORS++))
fi

# Check: has info.title
if ! grep -q "title:" "$FILE"; then
    echo "  FAIL: Missing 'info.title'"
    ((ERRORS++))
fi

# Check: has info.version
if ! grep -q "version:" "$FILE"; then
    echo "  FAIL: Missing 'info.version'"
    ((ERRORS++))
fi

# Check: has at least one path
if ! grep -q "^paths:" "$FILE"; then
    echo "  FAIL: Missing 'paths:' section"
    ((ERRORS++))
fi

# Check: has at least one HTTP method under paths
if ! grep -qE "^\s+(get|post|put|delete|patch):" "$FILE"; then
    echo "  FAIL: No HTTP methods found under paths"
    ((ERRORS++))
fi

if [[ $ERRORS -gt 0 ]]; then
    exit 1
fi

exit 0
