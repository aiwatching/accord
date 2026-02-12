# /accord-check-results

Check the status and results of remote command requests.

## Instructions

1. **Pull latest**:
   ```
   git pull --quiet
   ```

2. **Scan for command requests**:
   - Check `comms/archive/` for completed `req-*-cmd-*.md` files
   - Check `comms/inbox/*/` for pending or in-progress `req-*-cmd-*.md` files

3. **Build a results table**:

   | Request | Service | Command | Status | Result |
   |---------|---------|---------|--------|--------|
   | req-005-cmd-status | frontend | status | completed | 3 endpoints, 2 contracts |
   | req-006-cmd-scan | backend | scan | pending | (waiting) |

4. **For completed commands**: show the full `## Result` section content from the archived request file

5. **For pending/in-progress commands**: show "(waiting — service has not processed yet)"

6. **If no command requests found**: report "No remote commands have been sent. Use `/accord-remote-command` to send one."
