# /accord-remote-command

Send a diagnostic command to a service via the Accord protocol.

## Instructions

1. **Ask the user**: Which service? Which command? (status / scan / check-inbox / validate)
   - If arguments are needed (e.g., validate a specific contract), ask for those too

2. **Determine next request ID**:
   - Scan `comms/inbox/` and `comms/archive/` for existing `req-*-cmd-*.md` files
   - Find the highest request number, increment by 1
   - Format: `req-{NNN}-cmd-{command}`

3. **Create the command request** in `comms/inbox/{service}/req-{NNN}-cmd-{command}.md`:

   ```yaml
   ---
   id: req-{NNN}-cmd-{command}
   from: orchestrator
   to: {service}
   scope: external
   type: command
   command: {command}
   command_args: "{args or empty}"
   priority: medium
   status: pending
   created: {ISO-8601 timestamp}
   updated: {ISO-8601 timestamp}
   ---

   ## What

   Remote command: `{command}`

   ## Proposed Change

   N/A — diagnostic command, no contract changes.

   ## Why

   Orchestrator diagnostic: requested by user.

   ## Impact

   None — read-only diagnostic command.
   ```

4. **Write history entry**:
   ```
   bash protocol/history/write-history.sh \
     --history-dir comms/history \
     --request-id req-{NNN}-cmd-{command} \
     --from-status "" \
     --to-status pending \
     --actor orchestrator \
     --detail "Sent remote command: {command} to {service}"
   ```

5. **Commit and push**:
   ```
   git add comms/
   git commit -m "orchestrator: command - send {command} to {service}"
   git push
   ```

6. **Report**: "Sent `{command}` to {service} as `req-{NNN}-cmd-{command}`. Use `/accord-check-results` to see output after the service processes it."
