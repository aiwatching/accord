# /accord-status — Show Current Plan Progress

## Usage
`/accord-status`

## What This Does

Reads the active plan and displays progress.

## Instructions

1. Look in `.accord/plans/` for YAML files with `status: pending` or `status: in-progress`.
   - If no active plans found, check `.accord/plans/archive/` for the most recent completed plan.
   - If nothing found at all, tell the user: "No plans found. Run `/accord-plan <task>` to create one."

2. For the active plan, display:

   ```
   Plan: <task description>
   Status: <plan status>
   Progress: <completed>/<total> steps

   | # | Module | Description | Status |
   |---|--------|-------------|--------|
   | 1 | module-a | <description> | completed |
   | 2 | module-b | <description> | in-progress |
   | 3 | module-c | <description> | pending |
   ```

3. For completed steps, also show:
   - Summary of what was done
   - Files changed count

4. If the plan has failed steps, highlight them and suggest `/accord-replan`.
