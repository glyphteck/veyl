# Changelog

Repo-level changes are listed newest first. Keep entries short and concrete. Broad pushes get grouped bullets, while narrow fixes can use one concise bugfix or cleanup bullet that still names the actual change.

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
