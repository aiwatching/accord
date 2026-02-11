# /accord-validate

Run all Accord validators to check format compliance across the entire project.

## Instructions

### 1. Locate Validators

The validators are in the Accord repository at `protocol/scan/validators/`:
- `validate-openapi.sh` — checks external contract format
- `validate-internal.sh` — checks internal contract format
- `validate-request.sh` — checks request file format

If the Accord repo path is unknown, check if these exist relative to the project or ask the user.

### 2. Validate External Contracts

For each `.accord/contracts/*.yaml` file:
```bash
bash /path/to/accord/protocol/scan/validators/validate-openapi.sh <file>
```
Report PASS or FAIL with details.

### 3. Validate Internal Contracts

For each `.accord/contracts/internal/*.md` file:
```bash
bash /path/to/accord/protocol/scan/validators/validate-internal.sh <file>
```

### 4. Validate Request Files

For each `.md` file in `.accord/comms/inbox/*/` and `.accord/comms/archive/`:
```bash
bash /path/to/accord/protocol/scan/validators/validate-request.sh <file>
```

### 5. Cross-Reference Checks

Beyond format validation, check logical consistency:

- **Contract references**: Each request's `related_contract` field points to a file that exists
- **Proposed annotations**: Each `x-accord-status: proposed` in a contract has a matching request file
- **Request-contract alignment**: Each `x-accord-request: req-XXX` annotation has a corresponding request that is not yet completed
- **Config completeness**: All services in config have a contract file; all modules have an internal contract

### 6. Report

Format the output as a validation report:
```
=== Accord Validation Report ===

External Contracts:
  .accord/contracts/demo-engine.yaml       PASS
  .accord/contracts/device-manager.yaml   PASS
  .accord/contracts/frontend.yaml         PASS
  .accord/contracts/demo-admin.yaml        PASS

Internal Contracts:
  .accord/contracts/internal/plugin.md      PASS
  .accord/contracts/internal/discovery.md   PASS
  .accord/contracts/internal/lifecycle.md   PASS

Requests:
  .accord/comms/inbox/demo-admin/req-002-rbac-permissions.md   PASS
  .accord/comms/archive/req-001-policy-by-type.md             PASS

Cross-references:
  req-002 → .accord/contracts/demo-admin.yaml   PASS (file exists)
  demo-admin.yaml proposed → req-002            PASS (request exists)

Summary: 10 checked, 10 passed, 0 failed
```
