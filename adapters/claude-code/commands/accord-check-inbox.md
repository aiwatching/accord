# /accord-check-inbox

Check for incoming Accord requests in your module's inbox.

## Instructions

1. Check repo model in `.accord/config.yaml`:
   - Multi-repo: run `bash .accord/accord-sync.sh pull --target-dir .` to sync contracts and requests from hub
   - Monorepo: requests are already local, no pull needed for comms

2. **Determine your working module** — if not already established, infer from context or ask the user

3. **Check YOUR inbox only** — `{{COMMS_DIR}}inbox/{your-module}/`:
   - ONLY read requests in YOUR module's inbox directory
   - Do NOT scan or report requests from other modules' inboxes
   - Read each `.md` file's YAML frontmatter
   - Note the `id`, `from`, `scope`, `type`, `priority`, `status`

4. **Auto-process command requests**:
   For each request with `type: command` and `status: pending`:
   a. Set status: `in-progress`, update timestamp
   b. Execute the command:
      - `status`: read `.accord/config.yaml`, list contracts, list pending requests — report summary
      - `scan`: run `/accord-scan` logic (scan source for contracts)
      - `check-inbox`: report current inbox contents (counts and IDs)
      - `validate`: run `/accord-validate` logic (validate contracts and requests)
   c. Write a `## Result` section at the end of the request file with the command output
   d. Set status: `completed`, update timestamp, move to archive (`{{COMMS_DIR}}archive/`)
   e. Commit: `git add .accord/ && git commit -m "comms({your-module}): completed - {req-id} (command)"`
   f. Multi-repo: `bash .accord/accord-sync.sh push --target-dir .`

5. **Report** to the user grouped by status:
   - **Pending** requests: awaiting human review (excluding command requests already processed)
   - **Approved** requests: ready to implement
   - **In-progress** requests: currently being worked on
   - **Auto-processed** command requests (if any were executed above)
   - For each, show: id, from, to, type, priority

6. If no requests found, report: "No incoming requests."

6. Also check recent contract changes:
   - Run `git log --oneline -5 -- {{CONTRACTS_DIR}}`
   - Run `git log --oneline -5 -- {{INTERNAL_CONTRACTS_DIR}}` (if applicable)
   - Report any recent changes
