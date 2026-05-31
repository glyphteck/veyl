# Glyphteck Agent Guide

Before starting feature work in this repo:

1. Read [README.md](README.md).
2. Read [guidelines/workflow.md](guidelines/workflow.md) for task sizing, todo, branch, worktree, handoff, and cleanup rules.
3. Read the focused files under [guidelines/](guidelines/) that match the task.
4. Check the root docs if the task touches their area:
    - [bots.md](bots.md) for bot behavior and operations
    - [guidelines/uistyling.md](guidelines/uistyling.md) for web and iOS UI styling
    - [guidelines/apple-review.md](guidelines/apple-review.md) for Apple App Review guideline mapping
    - [review.md](review.md) for Apple App Review posture
    - [legal.md](legal.md) for legal, privacy, and terms copy
    - [roadmap.md](roadmap.md), [ideas.md](ideas.md), [guidelines/todo.md](guidelines/todo.md), and [todo/](todo/) for planning context

## Non-Negotiables

- Linting is allowed. Prefer targeted lint runs for files or packages you touched.
- Do not run `git diff --check`, tests, builds, typechecks, formatters, or other non-lint verification commands unless the user explicitly asks.
- When changing backend deployable surfaces, including Firebase Functions, Firestore rules, Storage rules, indexes, or CORS/config scripts, deploy the changed backend target before handing the work back unless the user explicitly says not to deploy.
- Do not hand edit generated or vendor directories unless the task is explicitly about them.
- Do not revert or overwrite user changes. Work with the current tree.
- Prefer small, clean changes over layering more code onto a messy path.
- Do not add backward compatibility, legacy fallbacks, compatibility shims, or migrations. Make clean cutovers to the current architecture.
- In forced auth, vault, and onboarding flows, do not push or replace to the next concrete step after completing a required write. Update state and let route guards or protected stacks choose the next route; use explicit navigation only for user-initiated optional routes or exits from non-forced surfaces.
- Keep root/auth shells dumb about app destinations. Last-route memory, chat-peer route memory, and any other app-state cache belong inside the unlocked vault boundary; outside the vault should only steer users toward auth, onboarding, or the vault unlock guard.
- Do not depend on VS Code tasks for repo operations. The repo intentionally has no `.vscode/` workflow source; use the Bun scripts documented in [guidelines/commands.md](guidelines/commands.md), including `bun push` and `bun merge`.
- Work in the current branch by default. Do not create, switch, or rename git branches unless the user explicitly asks for branch work or the concurrent-agent collision rule below applies.
- When creating branches, never use agent prefixes or namespace prefixes like `codex/`, `codex-`, or similar. Branch names should be as short as possible; prefer a meaningful single word when one is clear, using the naming rules in [guidelines/code.md](guidelines/code.md).
- When running repo push or merge workflows, use a specific commit message that describes the actual changes being committed. Do not use vague defaults like `update` unless the user explicitly asks for that exact message.
- Before running repo push or merge workflows, update [CHANGELOG.md](CHANGELOG.md). Broad updates need grouped, concrete bullets; narrow fixes can use one short bugfix or cleanup entry, but it must still name the actual change.
- Veyl wallet/backend data is pre-production unless the user says otherwise. Do not add legacy wallet/account compatibility or migrations by default; prefer the clean current architecture. Still ask before destructive live backend data deletion.
- Do not use `todo/` to list completed work. When a task is done, delete its task file or trim it to only unresolved work, then document implemented behavior directly in README, AGENTS, or focused docs.
- Do not create `todo/README.md` or any central todo index. Todo folder policy belongs in [guidelines/todo.md](guidelines/todo.md), and the folder contents are the active list.
- After a feature branch is merged, delete the merged feature branch and any abandoned predecessor branches, then document the shipped behavior in README, AGENTS, or focused docs the same way completed todo-planned features are documented.

## Workflow Summary

Detailed workflow rules live in [guidelines/workflow.md](guidelines/workflow.md). Keep this summary in mind:

- Small updates and narrow fixes usually stay on the current branch without a todo file or worktree.
- Large features, broad behavior changes, major refactors, and collision-prone work get one active task file under [todo/](todo/).
- If a large task needs isolation, create a short task-specific branch and linked worktree, then record both in the task file.
- The individual todo task file is the coordination record. Do not maintain a central todo list.
- When the task is done, remove or trim the todo file, move shipped behavior into durable docs when useful, and clean up merged or abandoned branches and worktrees.

## Current Architecture Map

- Web routes live in `apps/web/src/app`; web UI, providers, dialogs, and local primitives live in `apps/web/src/components`; web-only logic lives in feature folders under `apps/web/src/lib`.
- iOS routes live in `apps/ios/app`; iOS UI lives in `apps/ios/src/components`; iOS provider wiring lives in `apps/ios/src/providers`; iOS-only logic lives in feature folders under `apps/ios/src/lib`.
- Shared cross-platform product logic lives in `shared` as `@veyl/shared`. Generic primitives belong in `shared/utils/*`; feature logic belongs in folders such as `shared/chat`, `shared/wallet`, `shared/search`, `shared/cache`, `shared/navigation`, and `shared/bot`.
- Firebase Functions live in `functions`, outside the Bun workspace. Functions-local helpers stay in `functions/lib` unless the deploy package shape changes.
- Repo tooling lives in `scripts`; admin command helpers live in `scripts/admin`.
- Do not recreate deleted catch-all files such as root `shared/utils.js`, `shared/localdatacache.js`, web/iOS flat chat-media helpers, or shadcn `components.json` / `components/ui` scaffolding.

## Guideline Index

- [guidelines/workflow.md](guidelines/workflow.md): task sizing, todo files, branch/worktree policy, handoff, cleanup
- [guidelines/todo.md](guidelines/todo.md): todo folder policy, task-file shape, and cleanup rules
- [guidelines/repo.md](guidelines/repo.md): repo shape, Bun workspace, product model, account model, data model
- [guidelines/packages.md](guidelines/packages.md): package installs, upgrades, lockfiles, Expo SDK bumps, and native rebuild rules
- [guidelines/commands.md](guidelines/commands.md): install, run, build, bot, and local host commands
- [guidelines/code.md](guidelines/code.md): naming, code structure, refactors, shared-vs-client rules
- [guidelines/chat.md](guidelines/chat.md): encrypted chat lifecycle, retention, deletion, compaction, media, and module ownership
- [guidelines/navigation.md](guidelines/navigation.md): fast paths into auth, vault, wallet, chat, search, bots, and backend
- [guidelines/uistyling.md](guidelines/uistyling.md): web and iOS UI styling rules
- [guidelines/validation.md](guidelines/validation.md): validation policy and files to avoid
- [guidelines/bots.md](guidelines/bots.md): agent-facing bot development rules
- [guidelines/security.md](guidelines/security.md): auth, vault, chat, wallet, and backend security reminders
- [guidelines/apple-review.md](guidelines/apple-review.md): Apple App Review guideline mapping and submission checklist

Use the smallest relevant guideline set after reading the product context:

- Repo workflow, planning, branch, todo, or worktree work: read `guidelines/workflow.md`, `guidelines/todo.md`, `guidelines/repo.md`, `guidelines/code.md`, `guidelines/commands.md`, and `guidelines/validation.md`.
- Package, dependency, framework, Expo SDK, or lockfile work: read `guidelines/packages.md`, `guidelines/commands.md`, and `guidelines/validation.md`.
- Chat work: read `chat.md`, `repo.md`, `code.md`, `navigation.md`, and `security.md`.
- UI or styling work: read `code.md` and `uistyling.md`.
- Bot work: read `guidelines/bots.md` and the root [bots.md](bots.md).
- Local run or build work: read `commands.md` and `validation.md`.
- Apple review, App Store submission, review notes, or review-sensitive feature work: read `guidelines/apple-review.md`, `review.md`, `legal.md`, `security.md`, and `commands.md`.
