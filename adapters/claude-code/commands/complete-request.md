# /complete-request

Mark an Accord request as completed and archive it.

## Instructions

1. **Identify the request** to complete:
   - Check `{{COMMS_DIR}}inbox/{{TEAM_NAME}}/` for in-progress requests
   - Also check `{{TEAM_NAME}}/.agent-comms/inbox/{module}/` for internal requests
   - If multiple in-progress requests exist, ask the user which one

2. **Verify the contract is updated**:
   - External: confirm `{{CONTRACTS_DIR}}{{TEAM_NAME}}.yaml` includes the requested change and any `x-accord-status: proposed` annotations have been removed
   - Internal: confirm both the source contract (`{module}/.accord/contract.md`) and collected copy (`{{INTERNAL_CONTRACTS_DIR}}{module}.md`) are updated

3. **Update the request file**:
   - Set `status: completed`
   - Update the `updated:` timestamp to current time (ISO 8601)
   - Add a `## Resolution` section with a brief summary of what was implemented

4. **Archive the request**:
   - External: move from `{{COMMS_DIR}}inbox/{{TEAM_NAME}}/` to `{{COMMS_DIR}}archive/`
   - Internal: move from `{{TEAM_NAME}}/.agent-comms/inbox/{module}/` to `{{TEAM_NAME}}/.agent-comms/archive/`

5. **Commit and push**:
   ```
   git add .
   git commit -m "comms({{TEAM_NAME}}): completed - {request-id}"
   git push
   ```

6. **Report**: "Completed request {id}. Contract updated and request archived."

## Pre-checks

Before completing, verify:
- [ ] The contract file has been updated to reflect the requested change
- [ ] The implementation matches what the contract describes
- [ ] Any `x-accord-status: proposed` annotations have been removed from the contract
- [ ] The request status was previously `in-progress` (not `pending` or `approved`)
