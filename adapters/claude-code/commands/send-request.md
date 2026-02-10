# /send-request

Create and send an Accord request to another team or module.

## Instructions

1. **Determine scope**:
   - If the target is a team name from `{{TEAM_LIST}}` → scope is `external`
   - If the target is a module name from `{{MODULE_LIST}}` → scope is `internal`
   - Ask the user if unclear

2. **Gather details** from the user:
   - Target team or module name
   - What they need (brief description)
   - The proposed change (concrete API/interface details)
   - Why it's needed
   - Priority (low/medium/high/critical)

3. **Determine the next request ID**:
   - Check existing request files in `{{COMMS_DIR}}inbox/` and `{{COMMS_DIR}}archive/`
   - Also check `{{TEAM_NAME}}/.agent-comms/` if internal
   - Assign the next sequential number: `req-{NNN}-{short-description}`

4. **Create the request file** using the template from `{{COMMS_DIR}}TEMPLATE.md`:
   - Fill in all frontmatter fields
   - Set `status: pending`
   - Set timestamps to current time (ISO 8601)
   - Set `related_contract` to the appropriate contract path

5. **Place the request file**:
   - External: `{{COMMS_DIR}}inbox/{target-team}/{request-id}.md`
   - Internal: `{{TEAM_NAME}}/.agent-comms/inbox/{target-module}/{request-id}.md`

6. **(Optional) Annotate the target contract**:
   - External: add `x-accord-status: proposed` and `x-accord-request: {id}` to the relevant path in `{{CONTRACTS_DIR}}{target}.yaml`
   - Only if the proposed change is concrete enough

7. **Commit and push**:
   ```
   git add {{COMMS_DIR}} {{CONTRACTS_DIR}}
   git commit -m "comms({target}): request - {summary}"
   git push
   ```

8. **Report**: "Created request {id} to {target}. Status: pending. Needs their approval."
