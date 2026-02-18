# /accord-replan — Revise the Remaining Plan Steps

## Usage
`/accord-replan`

## What This Does

Re-invokes the `accord-architect` skill to revise the remaining (non-completed) steps of the active plan, taking into account what has already been done.

## Instructions

1. Verify prerequisites:
   - Check that `.accord/plans/` contains at least one active plan (status: pending or in-progress)
   - If no active plan, tell the user: "No active plan found. Run `/accord-plan <task>` first."

2. Invoke the `accord-architect` skill in **Replan** mode:
   - The skill will read the existing plan
   - Keep all completed steps unchanged
   - Re-analyze and regenerate remaining steps based on current state

3. Present the revised plan to the user for approval.

4. After approval, suggest: "Run `/accord-execute` to continue execution."
