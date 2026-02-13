#!/usr/bin/env bash
# Validates that a service.yaml file meets Accord v2 format requirements.
#
# Usage: validate-service-yaml.sh <path-to-yaml>
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
    *) echo "  WARN: Service config should have .yaml extension"; WARNINGS=$((WARNINGS + 1)) ;;
esac

# Check: required field — version
if ! grep -q "^version:" "$FILE"; then
    echo "  FAIL: Missing required field: version"
    ERRORS=$((ERRORS + 1))
fi

# Check: required field — service
if ! grep -q "^service:" "$FILE"; then
    echo "  FAIL: Missing required field: service"
    ERRORS=$((ERRORS + 1))
fi

# Check: required field — team
if ! grep -q "^team:" "$FILE"; then
    echo "  FAIL: Missing required field: team"
    ERRORS=$((ERRORS + 1))
fi

# Check: required field — hub
if ! grep -q "^hub:" "$FILE"; then
    echo "  FAIL: Missing required field: hub"
    ERRORS=$((ERRORS + 1))
fi

# Check: version format
if grep -q "^version:" "$FILE"; then
    version_value=$(grep "^version:" "$FILE" | head -1 | sed 's/^version:[[:space:]]*//' | tr -d '"' | tr -d "'")
    if ! echo "$version_value" | grep -qE "^[0-9]+\.[0-9]+"; then
        echo "  WARN: Version '$version_value' does not look like a semver"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

# Check: hub looks like a git URL or path
if grep -q "^hub:" "$FILE"; then
    hub_value=$(grep "^hub:" "$FILE" | head -1 | sed 's/^hub:[[:space:]]*//')
    if [[ -z "$hub_value" ]]; then
        echo "  FAIL: hub field is empty"
        ERRORS=$((ERRORS + 1))
    fi
fi

# Check: service name is non-empty and reasonable
if grep -q "^service:" "$FILE"; then
    svc_value=$(grep "^service:" "$FILE" | head -1 | sed 's/^service:[[:space:]]*//')
    if [[ -z "$svc_value" ]]; then
        echo "  FAIL: service field is empty"
        ERRORS=$((ERRORS + 1))
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
