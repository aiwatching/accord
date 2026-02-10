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

For each `contracts/*.yaml` file:
```bash
bash /path/to/accord/protocol/scan/validators/validate-openapi.sh <file>
```
Report PASS or FAIL with details.

### 3. Validate Internal Contracts

For each service with modules (from `.accord/config.yaml` or `{service}/.accord/config.yaml`):

**Source contracts**:
```bash
for module in {modules}; do
  bash /path/to/accord/protocol/scan/validators/validate-internal.sh {service}/${module}/.accord/contract.md
done
```

**Collected copies**:
```bash
for f in {service}/.accord/internal-contracts/*.md; do
  bash /path/to/accord/protocol/scan/validators/validate-internal.sh "$f"
done
```

### 4. Validate Request Files

For each `.md` file in `.agent-comms/inbox/*/` and `.agent-comms/archive/`:
```bash
bash /path/to/accord/protocol/scan/validators/validate-request.sh <file>
```

Also check `{service}/.agent-comms/inbox/*/` and `{service}/.agent-comms/archive/`.

### 5. Cross-Reference Checks

Beyond format validation, check logical consistency:

- **Contract references**: Each request's `related_contract` field points to a file that exists
- **Proposed annotations**: Each `x-accord-status: proposed` in a contract has a matching request file
- **Request-contract alignment**: Each `x-accord-request: req-XXX` annotation has a corresponding request that is not yet completed
- **Source-collected sync**: Each module's source contract (`{module}/.accord/contract.md`) matches its collected copy (`{service}/.accord/internal-contracts/{module}.md`)
- **Config completeness**: All teams in config have a contract file; all modules in service config have a source contract

### 6. Report

Format the output as a validation report:
```
=== Accord Validation Report ===

External Contracts:
  contracts/nac-engine.yaml       PASS
  contracts/device-manager.yaml   PASS
  contracts/frontend.yaml         PASS
  contracts/nac-admin.yaml        PASS

Internal Contracts (source):
  device-manager/plugin/.accord/contract.md      PASS
  device-manager/discovery/.accord/contract.md   PASS
  device-manager/lifecycle/.accord/contract.md   PASS

Internal Contracts (collected):
  device-manager/.accord/internal-contracts/plugin.md      PASS
  device-manager/.accord/internal-contracts/discovery.md   PASS
  device-manager/.accord/internal-contracts/lifecycle.md   PASS

Requests:
  .agent-comms/inbox/nac-admin/req-002-rbac-permissions.md   PASS
  .agent-comms/archive/req-001-policy-by-type.md             PASS

Cross-references:
  req-002 → contracts/nac-admin.yaml              PASS (file exists)
  nac-admin.yaml proposed → req-002               PASS (request exists)
  Source-collected sync: plugin                    PASS (match)

Summary: 12 checked, 12 passed, 0 failed
```
