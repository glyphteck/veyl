# Native Storage Adapter

status: active
branch: current
worktree: current

## Scope

iOS native upload/download adapter placement.

## Current State

`apps/ios/src/lib/chat/media.js` still imports Firebase Storage primitives for React Native upload details.

That file is adapter plumbing consumed by `apps/ios/src/lib/cloud.js`, not product logic.

## Open Items

- Move native Firebase Storage plumbing under an iOS cloud adapter folder when the cloud package structure settles.
- Keep provider and chat product code independent from Expo/Firebase upload details where practical.

