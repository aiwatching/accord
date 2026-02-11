# /accord-complete-request

Mark an Accord request as completed and archive it.

## Instructions

1. **Identify the request** to complete:
   - Check `{{COMMS_DIR}}inbox/{your-module}/` for in-progress requests
   - If multiple in-progress requests exist, ask the user which one

2. **Verify the contract is updated**:
   - External: confirm `{{CONTRACTS_DIR}}{your-module}.yaml` includes the requested change and any `x-accord-status: proposed` annotations have been removed
   - Internal: confirm `{{INTERNAL_CONTRACTS_DIR}}{your-module}.md` is updated

3. **Update the request file**:
   - Set `status: completed`
   - Update the `updated:` timestamp to current time (ISO 8601)
   - Add a `## Resolution` section with a brief summary of what was implemented

4. **Archive the request**:
   - Move from `{{COMMS_DIR}}inbox/{your-module}/` to `{{COMMS_DIR}}archive/`

5. **Write history entry** (if `settings.history_enabled` is `true` in `.accord/config.yaml`):
   ```
   bash .accord/protocol/history/write-history.sh \
     --history-dir .accord/comms/history \
     --request-id {request-id} \
     --from-status in-progress \
     --to-status completed \
     --actor {your-module} \
     --detail "Completed: {brief summary}"
   ```

6. **Commit**:
   ```
   git add .accord/
   git commit -m "comms({your-module}): completed - {request-id}"
   ```
   - Multi-repo only: `bash .accord/accord-sync.sh push --target-dir .` to sync updated contract and archived request to hub
   - Monorepo: no push needed

7. **Report**: "Completed request {id}. Contract updated and request archived."

## Pre-checks

Before completing, verify:
- [ ] The contract file has been updated to reflect the requested change
- [ ] The implementation matches what the contract describes
- [ ] Any `x-accord-status: proposed` annotations have been removed from the contract
- [ ] The request status was previously `in-progress` (not `pending` or `approved`)
