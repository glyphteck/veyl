# Pagination Boundary

status: active
branch: current
worktree: current

## Scope

Message and chat-list "load more" state.

Paging is not message/chat ordering. Ordering already uses timestamps. Paging is the resume marker for fetching the next slice without loading the entire history.

## Current State

- Message history uses ordered timestamp queries and returns `before` / `nextBefore`.
- User chat-list loading still has internal `cursor` naming.
- The Firebase cloud adapter currently keeps Firestore document snapshots behind opaque page tokens.

## Target Direction

- Keep app-facing names simple, probably `after` / `nextAfter` for chat lists and `before` / `nextBefore` for older messages.
- Prefer a backend-neutral marker like `{ ts, id }` where possible.
- Keep Firestore snapshot tokens fully inside the Firebase adapter.

