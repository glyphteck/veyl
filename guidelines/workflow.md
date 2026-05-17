# Workflow Guidelines

Use this guide for agent workflow, task planning, branch decisions, worktrees, handoff notes, and cleanup.

## Default Posture

- Work in the current checkout and current branch by default.
- Treat unrelated dirty files as another agent's or the user's work. Do not revert, restyle, reformat, or opportunistically refactor them.
- Keep changes scoped to the task. Use task-specific file names, todo names, branch names, commit messages, PR text, and final notes when those surfaces are relevant.
- Do not create a branch, worktree, or todo file for narrow bugfixes, copy edits, targeted UI tweaks, or obvious cleanup unless there is a real collision risk.
- Use a branch and linked worktree only when the work is large, touches many files, or has an obvious chance of colliding with other active work.

## Task Size

Small work:

- Examples: one bug, one small UI tweak, one copy change, one direct cleanup.
- Read the relevant docs/source, make the smallest clean fix, review your diff, and hand it back.
- Do not create a todo file or worktree just for bookkeeping.

Large work:

- Examples: feature implementation, broad behavior change, major architecture work, large refactor, cross-platform chat/wallet changes, or many-file UI restructuring.
- Read `README.md`, all focused guideline files that apply, and the related source surfaces before deciding the implementation path.
- Create one task file under `todo/` before implementation if another agent may need to understand the work.
- Consider a branch and linked worktree when parallel work or file overlap makes the main checkout risky.

## Todo Task Files

Use [todo.md](todo.md) for todo folder policy, task-file shape, and cleanup rules. In short: `todo/` is for active large-feature coordination only, the folder contents are the active list, and implemented behavior belongs in durable docs instead of todo files.

## Branches And Worktrees

Branch names follow the code naming rules: short, lowercase, task-specific, and no agent prefixes or namespace prefixes such as `codex/` or `codex-`.

Prefer linked worktrees outside the repo root so generated files and nested checkouts do not appear as untracked app files:

```bash
mkdir -p ../worktrees
git worktree add -b shortbranch ../worktrees/shortbranch
git worktree list
```

Use an existing branch only when resuming existing work:

```bash
git worktree add ../worktrees/shortbranch shortbranch
```

Worktree rules:

- Create or update the coordination todo task file before starting the linked worktree when the work is large or collision-prone.
- Record the worktree path and branch in the task file.
- Keep dependency installs, dev servers, and generated caches local to that worktree.
- Do not run repo push or merge workflows from the wrong checkout. Confirm the branch and intended diff first.
- Remove the linked worktree after the work is merged or abandoned.

Cleanup:

```bash
git worktree remove ../worktrees/shortbranch
git branch -d shortbranch
```

If a worktree was manually deleted, use `git worktree prune` after confirming no active work depends on it.

## Large Feature Lifecycle

Use the full lifecycle only for large feature implementation, broad behavior changes, major architecture work, or large refactors.

1. Read `README.md` for product and architecture context.
2. Read every file under `guidelines/`, then reread the focused guideline files that match the task.
3. Crawl related source files, shared modules, providers, routes, rules, backend surfaces, and docs before deciding the approach.
4. Stage the implementation plan in a dedicated `todo/` file.
5. If needed, create a short task branch and linked worktree, then record both in the task file.
6. Implement the smallest clean change that matches the plan and existing code patterns.
7. Review the implementation from a code-review stance and fix actionable issues.
8. If product or device testing is needed, stop after review and clearly list what @zxrl should test.
9. Once @zxrl confirms the behavior, review again if the tested behavior changed or exposed follow-up issues.
10. Remove or trim the task file and move shipped behavior into durable docs where useful.
11. After merge, delete merged and abandoned task branches and remove linked worktrees.

## Handoffs

Final handoff notes should name:

- the task file, branch, and worktree if used
- the main files changed
- validation performed, usually lint only unless the user asked for more
- product or device testing still needed
- any unrelated dirty files intentionally ignored
