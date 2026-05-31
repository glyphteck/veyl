# Todo Guidelines

`todo/` is an active planning and coordination area for large features, broad behavior changes, major architecture work, and collision-prone refactors. It is not a changelog, release index, or place to preserve completed work. Shipped repo history belongs in [../CHANGELOG.md](../CHANGELOG.md).

Small updates, narrow bugfixes, copy changes, targeted UI tweaks, and obvious cleanup usually do not need a todo file.

## Rules

- Keep one active feature or implementation plan per file.
- Use lowercase task-specific filenames.
- Do not keep a `todo/README.md`; todo policy belongs in `AGENTS.md` and this guide.
- Do not maintain a central list of todo files. The folder contents are the list.
- Treat each task file as the coordination record. If the task uses a branch or linked worktree, record the branch and worktree path in that task file.
- Do not treat a todo file as change tracking. Use Git status, diffs, and `bun dirty` to track actual file changes.
- For worktree-backed tasks, keep the coordination task file visible from the primary checkout's `todo/`; do not leave the only task record inside a linked worktree.
- Do not list implemented behavior in `todo/`. When a task is done, delete its file or trim it to only unresolved work.
- Move shipped behavior into the focused durable doc that owns it when useful. Update `README.md` only when the human overview changes, and update `AGENTS.md` only when repo-wide agent rules change.
- If a task is mostly done but still has an unresolved product or security decision, keep only that unresolved decision in the todo file.

## Optional Shape

Use this shape only when branch, worktree, ownership, or handoff details matter:

```md
# Task Name

status: active
branch: current
worktree: current
base: main@<commit>
owner: optional

## Scope

What this task changes and what it intentionally does not change.

## Write Boundary

Files, modules, routes, or docs this task expects to touch.

## Collision Notes

Related active tasks, branches, worktrees, or surfaces to avoid.

## Plan

The current implementation plan.

## Handoff

Current state, blockers, review notes, and what @zxrl should test.
```

Paths in task files are relative to the repo root unless they are absolute.
