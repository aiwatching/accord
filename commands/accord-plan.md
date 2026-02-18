# /accord-plan — Plan a Multi-Module Task

## Usage
`/accord-plan <task description>`

## What This Does

Invokes the `accord-architect` skill (Phase 1: Plan) to analyze a task, determine which modules are affected, and create a dependency-ordered execution plan.

## Instructions

1. The task description is: `$ARGUMENTS`
   - If empty, ask the user to describe the task.

2. Verify prerequisites:
   - Check that `.accord/module-map.yaml` exists and is not empty
   - If missing, tell the user: "No module map found. Run `/accord-scan full` first."

3. Invoke the `accord-architect` skill in **Plan** mode:
   - Pass the task description
   - The skill will read the architecture files, analyze scope, and generate a plan

4. The skill will write a plan file to `.accord/plans/<task-slug>.yaml` and present it for review.

5. After the plan is presented, ask the user:
   - "Approve this plan? Run `/accord-execute` to start execution, or `/accord-replan` to adjust."
