# /accord-sync

Sync contracts and requests with the Accord hub repository (multi-repo only).

## Instructions

1. Read `.accord/config.yaml` — verify `repo_model: multi-repo` and `hub:` URL exists
   - If not multi-repo, tell the user: "Sync is only needed for multi-repo setups."

2. If `.accord/hub/` doesn't exist, run the sync init:
   ```bash
   bash ~/.accord/accord-sync.sh init --target-dir .
   ```

3. Ask the user: **pull** or **push**?

4. **Pull** (receive from hub):
   ```bash
   bash ~/.accord/accord-sync.sh pull --target-dir .
   ```
   - After pull, check inbox for new requests and report findings
   - Note any updated contracts from other services

5. **Push** (send to hub):
   ```bash
   bash ~/.accord/accord-sync.sh push --target-dir .
   ```
   - Pushes: own contract, outgoing requests, archived requests
   - Report what was synced

6. Report results to the user:
   - Number of new requests received (pull)
   - Number of changes pushed (push)
   - Any errors encountered
