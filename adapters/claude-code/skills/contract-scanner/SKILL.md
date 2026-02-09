# Contract Scanner Skill

---
name: contract-scanner
description: >
  Auto-detect and generate Accord contracts from source code.
  This is the Claude Code-specific wrapper around the protocol-layer
  scan instructions (protocol/scan/SCAN_INSTRUCTIONS.md).
---

## When to Scan

- User says "generate contracts" or "update contracts"
- A new service directory is added to the project
- User runs `/accord-scan` command
- During `accord init` when onboarding an existing codebase

## How to Scan

### External Contracts (REST API)

1. Read `.accord/config.yaml` to identify the target service
2. Find all controller/route files in the service directory
3. For Java/Spring: look for `@RestController`, `@RequestMapping`, `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`
4. For Python/FastAPI: look for `@app.get`, `@app.post`, `@router.get` decorators
5. For TypeScript/Express: look for `router.get()`, `router.post()`, `app.get()`
6. For each endpoint, extract: path, method, parameters, request/response types
7. Generate OpenAPI 3.0 YAML at `contracts/{service-name}.yaml`
8. Mark all generated content with `x-accord-status: draft`

### Internal Contracts (Module Interfaces)

1. Identify sub-module boundaries (separate packages/directories within the service)
2. Find public interfaces/protocols/ABCs that are **imported by other modules**
3. For each cross-module interface, extract: method signatures, parameter types, return types
4. Extract behavioral notes from JavaDoc/docstrings if available
5. Generate contract markdown at `{service}/.accord/internal-contracts/{module}.md`
6. Mark with `status: draft` in frontmatter
7. Include a `## Used By` section listing which modules depend on this interface

## Output Format

Follow the templates in `protocol/templates/` exactly:
- External: `protocol/templates/contract.yaml.template`
- Internal: `protocol/templates/internal-contract.md.template`

## Post-Scan

After generating contracts:
1. Inform user: "Generated {N} contracts with status: draft. Please review."
2. Run validators: `protocol/scan/validators/validate-openapi.sh` and `validate-internal.sh`
3. Report validation results
4. Do NOT commit automatically — let the user review first

## Reference

Core scanning rules are defined in `protocol/scan/SCAN_INSTRUCTIONS.md` (agent-agnostic).
This skill is a Claude Code convenience wrapper around those rules.
