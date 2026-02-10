# Accord Debug Log Format

Version: 0.1.0-draft

This document defines the structured logging format for Accord debug mode. When debug logging is enabled, agents write structured log entries to `.accord/log/` as they perform protocol operations. These logs enable tracing, debugging, and visualization of cross-boundary coordination.

---

## 1. Enabling Debug Logging

Debug logging is controlled by the `debug` setting in `.accord/config.yaml`:

```yaml
settings:
  debug: true       # Enable debug logging (default: false)
```

When `debug` is `false` or absent, agents MUST NOT write log entries. When `true`, agents SHOULD log all protocol-relevant actions listed in Section 4.

---

## 2. Log Directory

- **Location**: `.accord/log/`
- **File format**: JSONL (one JSON object per line)
- **File naming**: `{YYYY-MM-DD}T{HH-MM-SS}_{module}.jsonl`
  - Example: `2026-02-10T14-30-00_device-manager.jsonl`
  - One file per agent session
- **Git exclusion**: `.accord/log/.gitignore` excludes `*.jsonl` — logs are local-only, never committed

The session filename serves as the session ID referenced in each log entry.

---

## 3. Log Entry Schema

Each line in a JSONL file is a single JSON object with the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ts` | string | Yes | ISO 8601 timestamp with timezone (e.g., `2026-02-10T14:30:00Z`) |
| `session` | string | Yes | Session ID — matches the log filename without `.jsonl` |
| `module` | string | Yes | Working module name (e.g., `device-manager`) |
| `action` | string | Yes | Action identifier from Section 4 |
| `category` | string | Yes | One of: `lifecycle`, `comms`, `contract`, `git`, `scan`, `config` |
| `detail` | string | Yes | Human-readable description of what happened |
| `files` | string[] | No | Array of affected file paths (relative to project root) |
| `request_id` | string | No | Related request ID (e.g., `req-001-add-policy-api`) |
| `status_from` | string | No | Previous status (for state transitions) |
| `status_to` | string | No | New status (for state transitions) |

### Example Entry

```json
{"ts":"2026-02-10T14:30:00Z","session":"2026-02-10T14-30-00_device-manager","module":"device-manager","action":"inbox_check","category":"comms","detail":"Found 2 pending requests","files":[".accord/comms/inbox/device-manager/req-001.md",".accord/comms/inbox/device-manager/req-002.md"]}
```

### Example State Transition Entry

```json
{"ts":"2026-02-10T14:35:00Z","session":"2026-02-10T14-30-00_device-manager","module":"device-manager","action":"request_start","category":"comms","detail":"Started work on req-001-add-policy-api","request_id":"req-001-add-policy-api","status_from":"approved","status_to":"in-progress"}
```

---

## 4. Action Types

### Lifecycle

| Action | When to Log |
|--------|------------|
| `session_start` | Agent session begins — log module name and directory scope |
| `session_end` | Agent session ends (if detectable) |
| `module_selected` | Agent determines its working module |
| `config_read` | Agent reads `.accord/config.yaml` |

### Comms

| Action | When to Log |
|--------|------------|
| `inbox_check` | Agent checks inbox — log count of requests found |
| `request_create` | Agent creates a new request file — include `request_id` and `files` |
| `request_approve` | Request status changes to approved — include `request_id`, `status_from`, `status_to` |
| `request_reject` | Request status changes to rejected — include `request_id`, `status_from`, `status_to` |
| `request_start` | Request status changes to in-progress — include `request_id`, `status_from`, `status_to` |
| `request_complete` | Request status changes to completed — include `request_id`, `status_from`, `status_to` |
| `request_archive` | Request moved to archive — include `request_id` and `files` |

### Contract

| Action | When to Log |
|--------|------------|
| `contract_read` | Agent reads a contract file — include `files` |
| `contract_update` | Agent modifies a contract — include `files` |
| `contract_annotate` | Agent adds `x-accord-status: proposed` annotation — include `files` and `request_id` |
| `contract_scan` | Agent initiates contract scanning |
| `contract_validate` | Agent runs contract validators — log pass/fail |

### Git

| Action | When to Log |
|--------|------------|
| `git_pull` | Agent runs `git pull` — log success/failure |
| `git_push` | Agent runs `git push` — log success/failure |
| `git_commit` | Agent commits — log commit message summary |
| `git_conflict` | Merge conflict detected — include `files` |

### Scan

| Action | When to Log |
|--------|------------|
| `scan_start` | Contract scan begins — log scope (external/internal/all) |
| `scan_complete` | Scan finishes — log number of contracts generated |
| `scan_validate` | Validation run on scanned output — log pass/fail |

---

## 5. Agent Logging Behavior

### How Agents Write Logs

1. At session start, if `settings.debug` is `true` in `.accord/config.yaml`:
   a. Generate a session ID: current timestamp + module name (e.g., `2026-02-10T14-30-00_device-manager`)
   b. Create the log file: `.accord/log/{session-id}.jsonl`
   c. Write a `session_start` entry
2. For each protocol action performed, append one JSON line to the log file
3. At session end (if detectable), write a `session_end` entry

### Writing a Log Entry

Append a single line of JSON to the session's log file. Do NOT pretty-print — one compact JSON object per line.

```bash
# Example: appending a log entry (shell)
echo '{"ts":"2026-02-10T14:30:00Z","session":"2026-02-10T14-30-00_device-manager","module":"device-manager","action":"session_start","category":"lifecycle","detail":"Session started for module device-manager"}' >> .accord/log/2026-02-10T14-30-00_device-manager.jsonl
```

### What NOT to Log

- Source code content or diffs
- File contents beyond paths
- User conversation messages
- Internal agent reasoning or chain-of-thought
- Secrets, credentials, or environment variables

---

## 6. Viewing Logs

### Log Viewer

The Accord debug viewer (`protocol/debug/viewer.html`) is a self-contained HTML file that can display log timelines:

- **Direct file access**: Open `viewer.html` in a browser and drag-drop `.jsonl` files onto it
- **HTTP serve mode**: Run `accord-log.sh` to serve logs with auto-refresh at `http://localhost:8420`

### CLI Summary

Use `/accord-log` (Claude Code) or check `.accord/log/` directly to:
- List all log files with session info
- Show entry counts and time ranges
- View recent entries from the latest session

---

## 7. Manifest File (for HTTP serve mode)

When serving logs via `accord-log.sh`, a `manifest.json` file is generated in `.accord/log/`:

```json
{
  "files": [
    "2026-02-10T14-30-00_device-manager.jsonl",
    "2026-02-10T15-00-00_nac-engine.jsonl"
  ],
  "generated": "2026-02-10T15:30:00Z"
}
```

The viewer fetches this manifest to discover available log files when running in HTTP mode.
