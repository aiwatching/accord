#!/usr/bin/env bash
# accord scan - Contract Scanner entry point
# Agent-agnostic: generates scanning prompts and validates output
#
# Usage:
#   accord scan --service <name> --type <external|internal|all>
#   accord scan --all
#
# This script is a prompt generator + output validator.
# In agent-assisted mode (default), it outputs a structured prompt
# for the current AI agent to execute the actual code analysis.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(pwd)"
CONFIG_FILE="$PROJECT_ROOT/.accord/config.yaml"
SCAN_INSTRUCTIONS="$SCRIPT_DIR/SCAN_INSTRUCTIONS.md"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
    echo "Usage: accord scan [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --service <name>    Service to scan"
    echo "  --type <type>       Scan type: external, internal, or all (default: all)"
    echo "  --all               Scan all services defined in config"
    echo "  --validate-only     Only validate existing contracts, don't generate"
    echo "  --help              Show this help"
    echo ""
    echo "Examples:"
    echo "  accord scan --service device-manager --type external"
    echo "  accord scan --service device-manager --type internal"
    echo "  accord scan --all"
}

# Parse arguments
SERVICE=""
SCAN_TYPE="all"
SCAN_ALL=false
VALIDATE_ONLY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --service)
            SERVICE="$2"
            shift 2
            ;;
        --type)
            SCAN_TYPE="$2"
            shift 2
            ;;
        --all)
            SCAN_ALL=true
            shift
            ;;
        --validate-only)
            VALIDATE_ONLY=true
            shift
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            usage
            exit 1
            ;;
    esac
done

# Validate inputs
if [[ "$SCAN_ALL" == false && -z "$SERVICE" ]]; then
    echo -e "${RED}Error: --service <name> or --all is required${NC}"
    usage
    exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
    echo -e "${RED}Error: .accord/config.yaml not found. Run 'accord init' first.${NC}"
    exit 1
fi

# Generate scanning prompt for agent
generate_prompt() {
    local service="$1"
    local type="$2"
    local service_dir="$PROJECT_ROOT/$service"

    echo "============================================"
    echo "ACCORD CONTRACT SCAN"
    echo "Service: $service"
    echo "Type: $type"
    echo "============================================"
    echo ""

    if [[ "$type" == "external" || "$type" == "all" ]]; then
        echo "## External Contract Scan"
        echo ""
        echo "Scan all source files in $service_dir/"
        echo "Following the rules in protocol/scan/SCAN_INSTRUCTIONS.md Section 3:"
        echo ""
        echo "1. Find all REST/HTTP endpoint definitions (controllers, routes, handlers)"
        echo "2. Extract: HTTP method, path, parameters, request/response types"
        echo "3. Generate OpenAPI 3.0 YAML at: .accord/contracts/${service}.yaml"
        echo "4. Mark with x-accord-status: draft"
        echo ""
        echo "Output file: $PROJECT_ROOT/.accord/contracts/${service}.yaml"
        echo ""
    fi

    if [[ "$type" == "internal" || "$type" == "all" ]]; then
        echo "## Internal Contract Scan"
        echo ""
        echo "Scan all source files in $service_dir/"
        echo "Following the rules in protocol/scan/SCAN_INSTRUCTIONS.md Section 4:"
        echo ""
        echo "1. Identify sub-module boundaries (separate packages/directories)"
        echo "2. Find public interfaces/protocols/ABCs imported by OTHER modules"
        echo "3. For each cross-module interface, extract: signatures, types, behavioral notes"
        echo "4. Generate contract markdown at: .accord/contracts/internal/{module}.md"
        echo "5. Mark with status: draft"
        echo ""
        echo "Output directory: $PROJECT_ROOT/.accord/contracts/internal/"
        echo ""
    fi

    echo "IMPORTANT: All generated contracts must have status: draft"
    echo "A human must review and change status to 'stable' before they are active."
}

# Run validation on existing contracts
validate_contracts() {
    local service="$1"
    local type="$2"
    local errors=0

    if [[ "$type" == "external" || "$type" == "all" ]]; then
        local ext_contract="$PROJECT_ROOT/.accord/contracts/${service}.yaml"
        if [[ -f "$ext_contract" ]]; then
            echo -e "Validating external contract: $ext_contract"
            if bash "$SCRIPT_DIR/validators/validate-openapi.sh" "$ext_contract"; then
                echo -e "  ${GREEN}PASS${NC}"
            else
                echo -e "  ${RED}FAIL${NC}"
                errors=$((errors + 1))
            fi
        else
            echo -e "  ${YELLOW}SKIP${NC} - $ext_contract not found"
        fi
    fi

    if [[ "$type" == "internal" || "$type" == "all" ]]; then
        local int_dir="$PROJECT_ROOT/.accord/contracts/internal"
        if [[ -d "$int_dir" ]]; then
            for contract in "$int_dir"/*.md; do
                [[ -f "$contract" ]] || continue
                echo -e "Validating internal contract: $contract"
                if bash "$SCRIPT_DIR/validators/validate-internal.sh" "$contract"; then
                    echo -e "  ${GREEN}PASS${NC}"
                else
                    echo -e "  ${RED}FAIL${NC}"
                    errors=$((errors + 1))
                fi
            done
        else
            echo -e "  ${YELLOW}SKIP${NC} - $int_dir not found"
        fi
    fi

    return $errors
}

# Main
if [[ "$VALIDATE_ONLY" == true ]]; then
    echo -e "${YELLOW}Running validation only...${NC}"
    if [[ "$SCAN_ALL" == true ]]; then
        echo "TODO: Parse config.yaml for all services"
    else
        validate_contracts "$SERVICE" "$SCAN_TYPE"
    fi
else
    if [[ "$SCAN_ALL" == true ]]; then
        echo "TODO: Parse config.yaml and scan all services"
        echo "For now, use --service <name> to scan a specific service"
    else
        generate_prompt "$SERVICE" "$SCAN_TYPE"
    fi
fi
