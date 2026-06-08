# Bot Runtime Backend Abstraction

status: active
branch: current
worktree: current
base: main@7d56e720d7e5
repo version: 0.14.6

## Scope

Rewrite the bot runtime and bot backend helpers around a server-agnostic backend boundary.

The client cloud abstraction now keeps encrypted app blobs backend-neutral as `Uint8Array`, with provider-specific encoding contained in the cloud adapter. The bot runtime can keep its current monolithic Firebase Admin SDK calls until the bot backend rewrite.

## Open Items

- Define the bot/server backend surface for runtime actions, profiles, moderation, chat links, chat messages, owner chat entries, inbox pings, push, and storage.
- Move bot byte storage and transport encoding behind that backend surface so bot chat helpers consume the same raw encrypted blob format as client shared code.
- Keep the current direct Firebase Admin SDK bot runtime working until the server-agnostic rewrite replaces it cleanly.
- Use the finished client cloud adapter as the requirements source for what the custom backend must provide.
