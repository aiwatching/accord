# /accord-log

Check debug logging status, list log files, and show session summaries.

## Instructions

### 1. Check Debug Status

Read `.accord/config.yaml` and check if `settings.debug` is `true`.

Report:
```
Debug logging: ENABLED / DISABLED
```

If disabled, tell the user: "To enable debug logging, set `debug: true` under `settings:` in `.accord/config.yaml`"

### 2. List Log Files

Check `.accord/log/` for `.jsonl` files. For each file:
- Parse the filename to extract session date/time and module name
- Count the number of lines (entries) in the file
- Read the first entry to get the session start time
- Read the last entry to get the session end time or last action

Format as a table:
```
Log Files:
  Session                              Module          Entries  Duration
  2026-02-10T14-30-00_device-manager   device-manager  42       12m
  2026-02-10T15-00-00_demo-engine       demo-engine      18       5m
```

If no log files exist, report: "No log files found in .accord/log/"

### 3. Latest Session Summary

If log files exist, read the most recent one and show a summary:

- Total entries by category (lifecycle, comms, contract, git, scan)
- Key actions performed (session_start, inbox_check, request_create, etc.)
- Any state transitions with request IDs
- Any errors or conflicts logged

Format:
```
Latest Session: 2026-02-10T14-30-00_device-manager
  lifecycle:  3 entries (session_start, module_selected, config_read)
  comms:      5 entries (inbox_check, request_create x2, request_complete x2)
  contract:   2 entries (contract_update x2)
  git:        4 entries (git_pull, git_commit x3)

  State transitions:
    req-001-add-policy-api: approved → in-progress → completed
```

### 4. Viewer Info

Tell the user they can launch the visual timeline viewer:
```
To view logs in the browser: ~/.accord/accord-log.sh
```
