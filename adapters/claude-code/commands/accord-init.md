# /accord-init

One-click Accord project setup: scaffold directories, generate contracts from source code, install adapter, and validate — all in one step.

## Instructions

### Step 1: Gather Project Information

Ask the user for:
- **Project name** (e.g., `next-nac`)
- **Service/module names** (comma-separated, e.g., `frontend,nac-engine,device-manager`)
- **Repo model**: monorepo or multi-repo? (default: monorepo)
- **Service with sub-modules?** If yes, ask for service name and module names
- **Language** for internal contracts: java, python, typescript, go (default: java)

If the project already has `.accord/config.yaml`, read it and skip this step.

### Step 2: Run init.sh

Run the Accord initialization script with the gathered information:

```bash
/path/to/accord/init.sh \
  --project-name <name> \
  --repo-model <model> \
  --services "<csv>" \
  --service <name> \
  --modules "<csv>" \
  --language <lang> \
  --adapter claude-code \
  --no-interactive
```

The path to `init.sh` is at the root of the Accord repository. If it's not available locally, ask the user where Accord is installed.

### Step 3: Auto-Scan Source Code

Now scan the actual source code to generate real contracts (replacing the templates):

**External contracts** — For each service directory that contains source code:
1. Find all REST endpoint definitions (controllers, routes, handlers)
2. Follow the detection rules in `protocol/scan/SCAN_INSTRUCTIONS.md` Section 3
3. Extract: HTTP method, path, parameters, request/response types
4. Generate OpenAPI 3.0 YAML at `.accord/contracts/{service}.yaml`
5. Mark with `x-accord-status: draft`

**Internal contracts** — If the service has sub-modules:
1. Identify cross-module interfaces following Section 4 of SCAN_INSTRUCTIONS.md
2. For each interface: extract signatures, types, behavioral notes from doc comments
3. Generate contract markdown at `.accord/contracts/internal/{module}.md`
4. Mark with `status: draft`

If a directory has no source code yet, keep the template contracts.

### Step 4: Validate

Run validators on all generated contracts:

```bash
# External contracts
for f in .accord/contracts/*.yaml; do
  bash /path/to/accord/protocol/scan/validators/validate-openapi.sh "$f"
done

# Internal contracts
for f in .accord/contracts/internal/*.md; do
  bash /path/to/accord/protocol/scan/validators/validate-internal.sh "$f"
done
```

Report any validation failures and fix them.

### Step 5: Report

Present a summary to the user:

```
Accord setup complete!

  Project:    {name}
  Services:   {list}
  Adapter:    Claude Code

Generated contracts:
  - .accord/contracts/{service-a}.yaml  (draft — from source scan)
  - .accord/contracts/{service-b}.yaml  (draft — template, no source found)
  - .accord/contracts/internal/{module}.md  (draft — from source scan)

Validation: all passed

Next steps:
  1. Review generated contracts and change status from 'draft' to 'stable'
  2. git add .accord && git commit -m "accord: init project"
  3. Use /accord-check-inbox to see incoming requests
  4. Use /accord-send-request to coordinate with other modules
```

### Important

- All generated contracts must have `status: draft` — never auto-set to `stable`
- Do NOT auto-commit — let the user review first
- If source code exists, always prefer scanning over templates
- If contracts already exist (from a previous init), do not overwrite them
