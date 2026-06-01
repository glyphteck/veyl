# Changelog

Repo-level changes are listed newest first. Keep entries short and concrete. Broad pushes get grouped bullets, while narrow fixes can use one concise bugfix or cleanup bullet that still names the actual change.

## 4.14.8 - 2026-06-01

- Reworked wallet transfer caching, history coverage, and transaction aggregation so wallet rows and balance charts stay scoped to the active wallet identity.
- Tuned web and iOS chat and transaction list rendering with coalesced chat snapshots, fixed row layouts, and larger transaction render windows.
- Added the active NIP-05 identity-base task plan for Veyl-owned public Nostr identifiers.

## 4.14.7 - 2026-06-01

- Replaced bot burst load testing with runtime-owned traffic actions for mixed, message, solo-message, transfer, funding, and stop workflows.
- Split bot traffic constants and message pools under `shared/bot/traffic/` and updated command, bot, and workflow docs.
- Made the path checker tolerate deleted tracked files during file-move validation.

## 4.14.5 - 2026-05-31

- Fixed stale shared and web relative imports exposed by the flattened app workspace build.

## 4.14.4 - 2026-05-31

- Flattened app workspace paths from `apps/veyl/*` to `apps/*` and updated workspace config, scripts, docs, lint scopes, and moved-app relative paths.

## 4.14.3 - 2026-05-31

- Reorganized shared, web, and iOS helpers around feature-owned folders for cache, chat, media, navigation, user, wallet, and generic primitives.
- Renamed the shared package surface to `@veyl/shared` and removed stale flat helper paths, deprecated imports, and shadcn config residue.
- Centralized legal copy in shared code and exposed the public web legal route from the shared source of truth.
- Updated agent-facing docs, active todos, and repo remarks to match the current architecture and remaining follow-up boundaries.

## 4.14.2 - 2026-05-30

- Renamed the local Veyl dev launcher from `bun veyl` to `bun dev` and updated command docs.
- Added queued bot burst actions for deterministic chat pressure runs from the live bot runtime.
- Adjusted web root/auth redirects and landing feature jumps to use document-level navigation where needed.

## 4.14.1 - 2026-05-30

- Fixed Vercel web builds by making the web-root `scripts/vercel-build.mjs` path resolve to the repo-root build helper.

## 4.14.0 - 2026-05-30

- Added encrypted chat retention controls, hidden-message checkpoints, adaptive message paging, and client-side cleanup for expired, hidden, duplicate, and superseded control rows.
- Hardened chat media saving and deletion with encrypted stay keys, saved-media stay collection, and app-provider flows that release media holds during chat and account deletion.
- Reworked chat media and avatar caching across web and iOS, including object URL cleanup, video thumbnail support, media viewer swipe/dismiss behavior, and bounded warmed chat batches.
- Simplified web auth to Firebase client auth, removed server session/admin helpers from the web app, and tightened vault/onboarding route guard ownership.
- Refreshed iOS and web navigation/menu surfaces, including home pager tabs, shared stack options, route-memory cleanup, and consistent dialog/sheet behavior.
- Centralized shared logic knobs in `shared/config.js` and updated chat, cache, upload, debounce, and maintenance code to read from that source.
- Updated Firebase rules, indexes, and functions for fixed unsaved message TTLs, saved-media stay keys, chat push routing from preview writes, and deployable chat cleanup surfaces.
- Updated bot behavior for hidden checkpoints, attachment mirroring, and shared chat/wallet/storage helpers.
- Added executable Firebase cost modeling and refreshed the cost docs with storage retention, Auth MAU, save-operation, and 1,000,000 DAU assumptions.
- Updated framework, package, and build plumbing, including Expo patch bumps, `expo-video-thumbnails`, Firebase 12.14.0, the Vercel build wrapper, and dependency cleanup.
