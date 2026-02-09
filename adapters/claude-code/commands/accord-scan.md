# /accord-scan

Scan source code and generate Accord contract files.

## Usage

```
/accord-scan                                    # Scan current service (all types)
/accord-scan --service device-manager           # Scan specific service
/accord-scan --service device-manager --type external   # External only
/accord-scan --service device-manager --type internal   # Internal only
```

## What It Does

1. Reads `.accord/config.yaml` to determine service and module structure
2. Follows the scanning rules in `protocol/scan/SCAN_INSTRUCTIONS.md`
3. Analyzes source code to identify:
   - **External**: REST endpoints, HTTP handlers, route definitions
   - **Internal**: Public interfaces/protocols/ABCs used across module boundaries
4. Generates contract files with `status: draft`
5. Runs format validators on generated contracts
6. Reports results — does NOT auto-commit

## Output

- External contracts: `contracts/{service}.yaml` (OpenAPI 3.0)
- Internal contracts: `{service}/.accord/internal-contracts/{module}.md`

All generated contracts are marked as `draft` and require human review.
