# Veyl Todo

AGENTS: This is the user's active planning area for large feature implementation, broad behavior changes, major architecture work, and large refactors. It is not a changelog. Small updates, narrow bugfixes, copy changes, targeted UI tweaks, and obvious cleanup do not need todo files.

Use [../guidelines/workflow.md](../guidelines/workflow.md) for the full task, branch, worktree, handoff, and cleanup policy.

## Task File Rules

- Keep one active feature or implementation plan per file.
- Use lowercase task-specific filenames.
- Treat the individual task file as the coordination record. If the task uses a branch or linked worktree, record both in that file.
- For worktree-backed tasks, keep the coordination task file visible from the primary checkout's `todo/`; do not leave the only task record inside the linked worktree.
- Do not turn this README into a constantly changing status board. Keep the release-critical index below curated.
- Do not list completed work here. When a task is done, delete its file or trim it to only unresolved work.
- Move shipped behavior into durable docs such as `README.md`, `AGENTS.md`, or focused guideline files when useful.

## Task File Template

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

Related active todo files, branches, worktrees, or surfaces to avoid.

## Plan

The current implementation plan.

## Handoff

Current state, blockers, review notes, and what @zxrl should test.
```

Paths in task files are relative to the repo root unless they are absolute.

## Release-Critical

- [Peer Avatar Versioning](peer-avatar-versioning.md)
- [Wallet Withdrawals And Fees](wallet-withdrawals-and-fees.md)
- [Wallet Privacy](wallet-privacy.md)
- [USDB Token And Multi-Currency Wallet](usdb-token-and-multi-currency-wallet.md)
- [Security And Crypto Audit](security-and-crypto-audit.md)
- [Wallet Deposit Watcher And Push Notifications](wallet-deposit-watcher-and-push-notifications.md)
- [Opaque Chat Payloads](opaque-chat-payloads.md)
- [Apple Review](apple-review.md)
- [Legal And Company](legal-and-company.md)
- [Launch](launch.md)
