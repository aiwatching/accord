# /accord-status

Display a comprehensive overview of the Accord project state for debugging and tracking.

## Instructions

Read the project state and produce a structured status report. Follow these steps in order:

### 1. Config

Read `.accord/config.yaml` and report:
- Project name, repo model
- Teams listed and whether each team's contract file exists
- If a team has modules: list the modules from config

### 2. External Contracts

For each file in `.accord/contracts/*.yaml`:
- Read the `x-accord-status` field from `info:` (stable/draft/deprecated)
- Count paths (endpoints)
- Check for any `x-accord-status: proposed` annotations on individual paths
- Report any proposed paths with their linked `x-accord-request`

Format as a table:
```
External Contracts:
  Contract                           Status    Endpoints  Proposed
  .accord/contracts/nac-engine.yaml  stable    4          0
  .accord/contracts/nac-admin.yaml   stable    3          1 (req-002)
```

### 3. Internal Contracts

For each file in `.accord/contracts/internal/*.md`:
- Read `status` from YAML frontmatter (stable/draft/proposed/deprecated)
- Count methods in the interface code block

Format as a table:
```
Internal Contracts:
  Module      Status  Methods
  plugin      stable  5
  discovery   stable  3
  lifecycle   stable  4
```

### 4. Requests

Scan all inbox and archive directories:
- `.accord/comms/inbox/*/` — active requests for each team/module
- `.accord/comms/archive/` — completed/rejected requests

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
git log --oneline -10 -- .accord/
```

Show the 10 most recent Accord-related commits.

### 6. Health Checks

Run quick checks and flag issues:
- [ ] `.accord/config.yaml` exists and is readable
- [ ] All teams in config have a matching contract file
- [ ] All team/module inboxes exist
- [ ] No requests stuck in `in-progress` for more than 7 days (check `updated` timestamp)
- [ ] No `draft` contracts that are older than 7 days (should be reviewed)
- [ ] No orphaned request files (referencing non-existent contracts)

Report issues as warnings:
```
Health:
  OK    Config is valid
  OK    All team contracts exist
  WARN  req-002 has been pending for 3 days
  WARN  .accord/contracts/frontend.yaml is still draft
```
