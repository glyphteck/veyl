# Opaque Chat Cutover

status: active
branch: opaquechat
worktree: /Users/zaksorel/glyphteck/worktrees/opaquechat

## Unresolved

- Before merging into a shared environment, wipe old deterministic chat data and bot chat cursor state if it exists there. This is destructive backend data cleanup, so it needs an explicit operator decision at cutover time.
- Run product smoke on web, iOS, and bot against the deployed rules/functions: start simultaneous chats, receive inbox wakes, edit own messages, reject forged peer edits, confirm payment requests with `pay_confirm`, delete messages from either side, save/unsave, and verify delete tombstones clear saved records/media holds.
- Watch invite/wake spam after launch. The accepted v1 model keeps the server opaque and only shape-validates recipient inbox writes, so abuse hardening is coarse account/chat bans until a server-owned counter path is chosen.
