# Glyphteck Agent Guide

Before starting feature work in this repo:

1. Read [README.md](README.md).
2. Read the focused files under [guidelines/](guidelines/) that match the task.
3. Check the root docs if the task touches their area:
    - [bots.md](bots.md) for bot behavior and operations
    - [guidelines/uistyling.md](guidelines/uistyling.md) for web and iOS UI styling
    - [review.md](review.md) for Apple App Review posture
    - [legal.md](legal.md) for legal, privacy, and terms copy
    - [roadmap.md](roadmap.md) and [todo/](todo/) for planning context

## Non-Negotiables

- Linting is allowed. Prefer targeted lint runs for files or packages you touched.
- Do not run `git diff --check`, tests, builds, typechecks, formatters, or other non-lint verification commands unless the user explicitly asks.
- When changing backend deployable surfaces, including Firebase Functions, Firestore rules, Storage rules, indexes, or CORS/config scripts, deploy the changed backend target before handing the work back unless the user explicitly says not to deploy.
- Do not hand edit generated or vendor directories unless the task is explicitly about them.
- Do not revert or overwrite user changes. Work with the current tree.
- Prefer small, clean changes over layering more code onto a messy path.
- Do not add backward compatibility, legacy fallbacks, compatibility shims, or migrations. Make clean cutovers to the current architecture.
- Do not depend on VS Code tasks for repo operations. The repo intentionally has no `.vscode/` workflow source; use the Bun scripts documented in [guidelines/commands.md](guidelines/commands.md), including `bun push` and `bun merge`.
- When creating branches, never use agent prefixes or namespace prefixes like `codex/`, `codex-`, or similar. Branch names should be as short as possible; prefer a meaningful single word when one is clear, using the naming rules in [guidelines/code.md](guidelines/code.md).
- When running repo push or merge workflows, use a specific commit message that describes the actual changes being committed. Do not use vague defaults like `update` unless the user explicitly asks for that exact message.
- Veyl wallet/backend data is pre-production unless the user says otherwise. Do not add legacy wallet/account compatibility or migrations by default; prefer the clean current architecture. Still ask before destructive live backend data deletion.
- Do not use `todo/` to list completed work. When a task is done, remove its feature file or cross out only the context that still matters, then document implemented behavior directly in README, AGENTS, or focused docs.
- After a feature branch is merged, delete the merged feature branch and any abandoned predecessor branches, then document the shipped behavior in README, AGENTS, or focused docs the same way completed todo-planned features are documented.

## Large Feature And Refactor Workflow

Use this full lifecycle only for large feature implementation, broad behavior changes, major architecture work, or large refactors.

Small updates, narrow bugfixes, copy changes, targeted UI tweaks, and obvious cleanup do not need a todo plan or the full lifecycle. For those, read the relevant context, make the smallest clean fix directly, review it, and update durable docs only if behavior or workflow guidance changed.

1. Crawl [README.md](README.md) for the product and architecture context.
2. Crawl every file under [guidelines/](guidelines/), then reread the focused guideline files that match the work.
3. Crawl the source files, shared modules, providers, routes, and docs related to the feature or refactor before deciding on the approach.
4. Stage the implementation plan in a dedicated file under [todo/](todo/) with enough detail for another agent to understand the intended architecture.
5. Keep one feature or implementation plan per todo file so parallel agents do not edit each other's planning files.
6. Implement the smallest clean change that matches the plan and the existing code patterns.
7. Review the implementation from a code-review stance and fix any actionable issues.
8. If the change needs product or device testing, stop after the review pass, ask @zxrl to test it, and clearly list what to test.
9. Once @zxrl is satisfied, review the code again if the tested behavior changed or exposed follow-up issues.
10. After review passes, remove the implemented feature file from [todo/](todo/) and document the current behavior in [README.md](README.md), this guide, and the focused guideline files where applicable.
11. After merge, delete the merged feature branch and any abandoned predecessor branches.
12. Keep Markdown docs current with the repo state. Planning docs should describe pending work, while durable docs should describe implemented behavior.

## Guideline Index

- [guidelines/repo.md](guidelines/repo.md): repo shape, Bun workspace, product model, account model, data model
- [guidelines/commands.md](guidelines/commands.md): install, run, build, bot, and local host commands
- [guidelines/code.md](guidelines/code.md): naming, code structure, refactors, shared-vs-client rules
- [guidelines/navigation.md](guidelines/navigation.md): fast paths into auth, vault, wallet, chat, search, bots, and backend
- [guidelines/uistyling.md](guidelines/uistyling.md): web and iOS UI styling rules
- [guidelines/validation.md](guidelines/validation.md): validation policy and files to avoid
- [guidelines/bots.md](guidelines/bots.md): agent-facing bot development rules
- [guidelines/security.md](guidelines/security.md): auth, vault, chat, wallet, and backend security reminders

Use the smallest relevant guideline set after reading the product context:

- Chat work: read `repo.md`, `code.md`, `navigation.md`, and `security.md`.
- UI or styling work: read `code.md` and `uistyling.md`.
- Bot work: read `guidelines/bots.md` and the root [bots.md](bots.md).
- Local run or build work: read `commands.md` and `validation.md`.
