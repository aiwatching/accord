#!/usr/bin/env bash
# Validates that a YAML registry file meets Accord v2 format requirements.
#
# Usage: validate-registry-yaml.sh <path-to-yaml>
# Exit 0 = valid, Exit 1 = invalid

set -euo pipefail

FILE="$1"

if [[ ! -f "$FILE" ]]; then
    echo "Error: File not found: $FILE"
    exit 1
fi

ERRORS=0
WARNINGS=0

# Check: file has .yaml or .yml extension
case "$FILE" in
    *.yaml|*.yml) ;;
    *) echo "  WARN: Registry file should have .yaml extension"; WARNINGS=$((WARNINGS + 1)) ;;
esac

# Check: required field — name
if ! grep -q "^name:" "$FILE"; then
    echo "  FAIL: Missing required field: name"
    ERRORS=$((ERRORS + 1))
fi

# Check: required field — maintainer
if ! grep -q "^maintainer:" "$FILE"; then
    echo "  FAIL: Missing required field: maintainer"
    ERRORS=$((ERRORS + 1))
fi

# Check: maintainer value is valid
if grep -q "^maintainer:" "$FILE"; then
    maintainer_value=$(grep "^maintainer:" "$FILE" | head -1 | sed 's/^maintainer:[[:space:]]*//')
    case "$maintainer_value" in
        ai|human|hybrid|external) ;;
        *) echo "  FAIL: Invalid maintainer: $maintainer_value (must be ai, human, hybrid, or external)"; ERRORS=$((ERRORS + 1)) ;;
    esac
fi

# Check: type value if present
if grep -q "^type:" "$FILE"; then
    type_value=$(grep "^type:" "$FILE" | head -1 | sed 's/^type:[[:space:]]*//')
    case "$type_value" in
        service|module) ;;
        *) echo "  FAIL: Invalid type: $type_value (must be service or module)"; ERRORS=$((ERRORS + 1)) ;;
    esac
fi

# Check: external maintainer should have team field
if grep -q "^maintainer: external" "$FILE"; then
    if ! grep -q "^team:" "$FILE"; then
        echo "  WARN: maintainer: external should specify a team field"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

# Check: module type should have directory and language
if grep -q "^type: module" "$FILE"; then
    if ! grep -q "^directory:" "$FILE"; then
        echo "  WARN: type: module should specify a directory field"
        WARNINGS=$((WARNINGS + 1))
    fi
    if ! grep -q "^language:" "$FILE"; then
        echo "  WARN: type: module should specify a language field"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

# Check: no template placeholders remain
if grep -q "{{" "$FILE"; then
    echo "  FAIL: File contains unresolved template placeholders ({{ }})"
    ERRORS=$((ERRORS + 1))
fi

if [[ $WARNINGS -gt 0 && $ERRORS -eq 0 ]]; then
    echo "  $WARNINGS warning(s)"
fi

if [[ $ERRORS -gt 0 ]]; then
    exit 1
fi

exit 0
