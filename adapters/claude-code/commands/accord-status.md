# /accord-status

Display a comprehensive overview of the Accord project state for debugging and tracking.

## Instructions

Read the project state and produce a structured status report. Follow these steps in order:

### 1. Config

Read `.accord/config.yaml` and report:
- Project name, repo model
- Teams listed and whether each team's contract file exists
- If a service has modules: read `{service}/.accord/config.yaml` and list modules

### 2. External Contracts

For each file in `contracts/*.yaml`:
- Read the `x-accord-status` field from `info:` (stable/draft/deprecated)
- Count paths (endpoints)
- Check for any `x-accord-status: proposed` annotations on individual paths
- Report any proposed paths with their linked `x-accord-request`

Format as a table:
```
External Contracts:
  Contract                  Status    Endpoints  Proposed
  contracts/nac-engine.yaml stable    4          0
  contracts/nac-admin.yaml  stable    3          1 (req-002)
```

### 3. Internal Contracts

For each file in `{service}/.accord/internal-contracts/*.md`:
- Read `status` from YAML frontmatter (stable/draft/proposed/deprecated)
- Count methods in the interface code block
- Check if source of truth matches collected copy (`{module}/.accord/contract.md` vs collected)

Format as a table:
```
Internal Contracts (device-manager):
  Module      Status  Methods  Source=Collected
  plugin      stable  5        yes
  discovery   stable  3        yes
  lifecycle   stable  4        yes
```

### 4. Requests

Scan all inbox and archive directories:
- `.agent-comms/inbox/*/` — active requests for each team
- `.agent-comms/archive/` — completed/rejected requests
- `{service}/.agent-comms/inbox/*/` — module-level requests
- `{service}/.agent-comms/archive/` — module-level archived

For each request file, read frontmatter: `id`, `from`, `to`, `scope`, `status`, `priority`, `created`

Format as tables grouped by status:
```
Active Requests:
  ID                        From      To        Scope     Status    Priority  Age
  req-002-rbac-permissions  frontend  nac-admin external  pending   high      1d

Archived Requests:
  ID                        Status     Archived
  req-001-policy-by-type    completed  2d ago
```

### 5. Recent Activity

Run these git commands and summarize:
```bash
git log --oneline -10 -- contracts/ .agent-comms/ '*/.accord/' '*/.agent-comms/'
```

Show the 10 most recent Accord-related commits.

### 6. Health Checks

Run quick checks and flag issues:
- [ ] `.accord/config.yaml` exists and is readable
- [ ] All teams in config have a matching contract file
- [ ] All team inboxes exist
- [ ] No requests stuck in `in-progress` for more than 7 days (check `updated` timestamp)
- [ ] No `draft` contracts that are older than 7 days (should be reviewed)
- [ ] Source contracts match collected copies (internal)
- [ ] No orphaned request files (referencing non-existent contracts)

Report issues as warnings:
```
Health:
  OK    Config is valid
  OK    All team contracts exist
  WARN  req-002 has been pending for 3 days
  WARN  contracts/frontend.yaml is still draft
```
