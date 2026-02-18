# /accord-execute — Execute the Next Plan Step

## Usage
`/accord-execute [all]`

## Modes
- (no argument) — Execute only the next pending step
- `all` — Execute all remaining steps sequentially

## What This Does

Invokes the `accord-architect` skill (Phase 2: Execute) to carry out the changes described in the active plan.

## Instructions

1. Determine the mode from `$ARGUMENTS`:
   - If empty: execute the next pending step only
   - If `all`: execute all remaining pending steps sequentially

2. Verify prerequisites:
   - Check that `.accord/plans/` contains at least one active plan (status: pending or in-progress)
   - If no active plan, tell the user: "No active plan found. Run `/accord-plan <task>` first."

3. Invoke the `accord-architect` skill in **Execute** mode:
   - Pass whether to execute one step or all
   - The skill will find the active plan, load context, and execute changes

4. After execution completes, report:
   - Which step(s) were completed
   - Files changed
   - Contracts updated
   - If more steps remain, suggest: "Run `/accord-execute` for the next step"
   - If all steps completed, the plan is moved to `.accord/plans/archive/`
