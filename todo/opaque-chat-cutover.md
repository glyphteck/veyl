# Opaque Chat Cutover

status: active
branch: main
worktree: /Users/zaksorel/glyphteck/veyl

## Unresolved

- Before merging into a shared environment, wipe old deterministic chat data and bot chat cursor state if it exists there. This is destructive backend data cleanup, so it needs an explicit operator decision at cutover time.
- Run product smoke at the end on web, iOS, and bot against the deployed rules/functions: start simultaneous chats, receive inbox pings, send established-chat messages without parent chat docs, edit own messages, reject forged peer edits, confirm payment requests with `pay_confirm`, hard-delete messages from either side, delete whole chats, save/unsave, and verify active clients clear deleted source docs.
- Send a push/inbox ping when a transfer to a user is confirmed so their client can notice the wallet event without waiting on foreground polling.
- Watch inbox ping delivery after launch. The accepted v1 model keeps the canonical chat log opaque while routing sealed pings through the `push` callable for recipient block enforcement, push rate limiting, and username notifications.
