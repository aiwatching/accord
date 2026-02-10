# /accord-dispatch

Analyze a feature request, break it into per-module tasks, and dispatch subagents to implement each part.

## Instructions

### 1. Understand the feature

Ask the user (if not already clear):
- What feature to implement?
- Any preference on implementation order?

### 2. Analyze module boundaries

Read project configuration:
- `.accord/config.yaml` — services, modules, and their contracts
- `.accord/registry/` — module responsibilities and data ownership
- External contracts in `{{CONTRACTS_DIR}}` — existing APIs per module
- Internal contracts in `{{INTERNAL_CONTRACTS_DIR}}` — existing interfaces per module

For each module, understand what it currently provides.

### 3. Build a dispatch plan

Determine:
- Which modules need to implement something
- What each module needs to do (new endpoint, new interface method, new logic, etc.)
- Dependencies between modules (does A need B's output first?)
- Which contracts need to be updated

Present the plan to the user:
```
Dispatch plan for: "Add device search to nac-admin"

  Step 1: device-manager (no dependency)
    - Add GET /api/devices/search endpoint
    - Update .accord/contracts/device-manager.yaml
    - Params: name (string), type (string), status (enum)
    - Returns: { devices: Device[], total: int }

  Step 2: nac-admin (depends on step 1)
    - Add admin search page/API that calls device-manager search
    - Update .accord/contracts/nac-admin.yaml if BFF endpoint added

Proceed? [y/n]
```

### 4. Dispatch

For each step, use the **Task tool** to spawn a subagent:

**Important rules for subagent prompts:**
- State which module the subagent is acting as
- List the files/directories it should work within
- Include the current contract content so it has context
- Specify what to implement and what contract to update
- Tell it to follow existing code patterns in that module

**Sequential dispatch** (when there are dependencies):
1. Spawn subagent for step 1
2. Wait for completion
3. Read the updated contract
4. Spawn subagent for step 2 with the updated contract as context

**Parallel dispatch** (when steps are independent):
- Spawn all subagents simultaneously using multiple Task tool calls

### 5. Verify and report

After all subagents complete:
1. Read all updated contracts
2. Run validators: `/accord-validate`
3. Check that implementations align with contracts
4. If any Accord requests were created (cross-service), note them

Report to user:
```
Dispatch complete:
  - device-manager: GET /api/devices/search implemented, contract updated
  - nac-admin: search feature implemented, calls device-manager API
  - Validation: all passed
  - New requests: none (same-session dispatch, no async handoff needed)
```

### 6. Sync to hub

After all subagents complete and reconciliation is done:
- Multi-repo: run `bash ~/.accord/accord-sync.sh push --target-dir .` to sync all changes to hub

### 7. When a cross-service request IS needed

If the target module is managed by a different service (different repo, different session):
- Don't dispatch a subagent — the other service's agent handles it
- Instead, use `/accord-send-request` to create the Accord request
- Continue with mock data / TODO markers
- The other service will pick it up on their next session
