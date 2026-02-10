# /accord-check-inbox

Check for incoming Accord requests across all inboxes.

## Instructions

1. Run `git pull` to get latest changes

2. **Determine your working module** — if not already established, infer from context or ask the user

3. **Check all inbox directories** under `{{COMMS_DIR}}inbox/`:
   - Focus on `{{COMMS_DIR}}inbox/{your-module}/` for requests directed at you
   - Read each `.md` file's YAML frontmatter
   - Note the `id`, `from`, `scope`, `type`, `priority`, `status`

4. **Report** to the user grouped by status:
   - **Pending** requests: awaiting human review
   - **Approved** requests: ready to implement
   - **In-progress** requests: currently being worked on
   - For each, show: id, from, to, type, priority

5. If no requests found, report: "No incoming requests."

6. Also check recent contract changes:
   - Run `git log --oneline -5 -- {{CONTRACTS_DIR}}`
   - Run `git log --oneline -5 -- {{INTERNAL_CONTRACTS_DIR}}` (if applicable)
   - Report any recent changes
