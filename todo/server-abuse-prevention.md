# Server Abuse Prevention

status: parked decision
branch: current
worktree: current
base: main@004b67abe2e1
repo version: 0.14.4

## Scope

Track the remaining chat message sending cap decision.

## Open Decision

Direct Firestore chat-message writes do not currently have a hard frequency cap for text/control sends. Adding one is a tradeoff because every strong design increases normal per-message cost, either through extra counter writes, callable sends, triggers, or a lease/token system that still adds server work.

Only pursue this if uncapped text/control send volume becomes a launch blocker. Do not add a per-message counter doc, per-message callable send, or per-message trigger just to satisfy the todo.
