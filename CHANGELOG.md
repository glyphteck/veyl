# Changelog

Repo-level changes are listed newest first. Keep entries short and concrete. Broad pushes get grouped bullets, while narrow fixes can use one concise bugfix or cleanup bullet that still names the actual change.

## 0.14.17 - 2026-06-11

- Aligned invite preview support copy with the `/join` slogan and simplified redundant product naming around slogan and variant helpers.

## 0.14.16 - 2026-06-11

- Reworked public invite links to root `?join/...` tokens with centralized preview copy, a search-only web main-menu copy action, and `/join` as the public web entry route.
- Tightened QR app-link parsing, external scan docs, and pending invite resume so QR wrappers stay separate from human-readable invite links.
- Replaced bot groups/behaviors with canonical bot roles across runtime controls, admin CLI commands, traffic labels, and bot documentation.
- Fixed iOS blocked-chat exits and shared expired-message window handling, and surfaced blocked web camera permission errors.

## 0.14.15 - 2026-06-11

- Added canonical Veyl app-link QR and invite handling with root invite previews, pending invite resume, and production/test/dev iOS app priority.

## 0.14.12 - 2026-06-10

- Added chat-preview privacy controls across web and iOS while keeping read-receipt and reaction controls stream-only without inbox pings.
- Hardened push privacy with generic callable responses and verbose-dev-only app/server logging.
- Added attacker-perspective vulnerability notes and refreshed security/cost docs for accepted profile search, chat-id capability scope, and current control-message costs.

## 0.14.10 - 2026-06-09

- Added the current vault secret registry shape with guarded migration plumbing, device-mixed local cache keys, and secret lifecycle documentation.
- Scoped chat pair and message crypto to active chat ids with separate link roots, updated ping proofs, and shared request-message ownership.
- Hardened web headers with nonce-based CSP in the Next proxy, removed app-authored inline scripts, and added browser security headers.
- Tightened wallet transfer cache reads by ignoring pending transfers and clamping cached history offsets.
- Updated bot secret boot/runtime handling and related admin docs.

## 0.14.8 - 2026-06-09

- Removed unlock icon animation waits from the vault unlock critical path and documented real-build validation for iOS load-time measurements.
- Stabilized avatar loading across web and iOS with retained previous images, cache-aware fallback hiding, and current/peer avatar cache adoption before refetching.
- Fixed the iOS avatar active-dot cutout so the avatar art is clipped away and the active dot floats over the screen behind it.
- Made the iOS wallet transaction footer loader visible for fast paged row reveals while keeping the faster transaction batch loading behavior.
- Added a direct new-chat action to the empty web chat panel.

## 0.14.7 - 2026-06-08

- Moved encrypted client blobs to raw `Uint8Array` boundaries with Firebase-owned byte/base64 encoding, added a shared versioned body envelope for chat/file payloads, and recorded the remaining encrypted user-data and bot-backend abstraction work.
- Reworked iOS chat and peer-picker keyboard geometry around `KeyboardChatScrollView`, added chat day separators on web and iOS, tightened username search, and centralized iOS media saving behind a full-library permission helper.
- Hardened chat-list and message-window handling with listener retry, cached chat restoration, retained visible delete/TTL windows, safer inbox ping errors, and preview-neutral retention drops.
- Updated the bot runtime to replace stale local runtimes during dev, load APNS process secrets, watch latest message docs, adopt peer retention, and write hidden checkpoints for peer read receipts.
- Refreshed Expo, Firebase, Next, React, Spark, keyboard-controller, camera, icon, and form dependencies, documented dev-client performance caveats, and removed completed keyboard/cloud-format/dev-only media-lag todos.

## 0.14.6 - 2026-06-07

- Fixed chat-list preview and timestamp handling so deleted latest messages drop previews, preserve confirmed chat ordering, and keep cross-client chat deletions live across the full local chat window.
- Capped camera media fanout to five recipients across web and iOS send-photo flows.
- Tightened the web settings dialog tab layout while keeping the profile save action anchored outside the profile card.

## 0.14.5 - 2026-06-07

- Simplified iOS avatar rendering to a single masked SVG image-or-glyph branch, removed the brittle avatar image cache renderer, and kept current-user avatars on versioned remote URLs while refreshing local cache in the background.
- Updated peer avatar resolution and profile hydration so cached peer records with avatar versions resolve their image source consistently across repeated iOS list instances.
- Tightened wallet, chat, bot-runtime, and settings flows around list hydration, action placement, transfer lifecycle state, and current launch follow-up notes.

## 0.14.4 - 2026-06-06

- Renamed provider-owned latest-message session code and lifecycle docs around message batches, with shared batch runtime ownership under `shared/chat/messages/batches/`.
- Grouped message batch controls behind `messageBatches`, split batch cleanup into its own helper, and kept route message loading in `usemessages`.
- Reserved `index.js` for true entrypoints, renamed chat message type renderers and the batch hook to named implementation files, and documented the convention.
- Refreshed chat media cost and active follow-up notes around direct Storage writes, direct message TTL/delete paths, and remaining server-abuse, keyboard, NIP-05, and wallet-fee work.

## 0.14.3 - 2026-06-05

- Split web and iOS chat message lists into message-local row, action, scroll, dot, and gesture modules, while keeping save and download actions named distinctly.
- Moved shared route-message derivation, deleted-window cleanup, and preview sync decisions into message helper modules so `usemessages` stays focused on route orchestration.

## 0.14.2 - 2026-06-05

- Moved chat media uploads to direct client Storage writes at opaque `chats/{chatId}/{mediaId}` paths, with encrypted message payloads carrying the random media id and direct client delete/save/unsave retention handling.
- Removed chat-scoped media upload and message-delete/check callables, added path-only chat media hold handling, and kept whole-chat deletion aligned with the new Storage prefix.
- Tightened chat message, preview, edit, receipt, and pending-state handling so live chat rows and chat-list previews update from the current encrypted message state.
- Fixed web shortcut ownership, iOS avatar cache settling, chat audio row rendering, and repeated chat/transaction list row stability issues.
- Moved user, message, chat, and session lifecycle documentation into the root `lifecycle/` folder and trimmed duplicate lifecycle text from chat and security guides.

## 0.14.1 - 2026-06-05

- Replaced chat-list and message-history pagination cursors with stable `{ ts, id }` markers and added a mounted message-window watch so hard-deleted or TTL-removed older messages disappear from already-rendered chat history.
- Added bounded local cache eviction for vaulted chat media, cached chats, peer profiles, and web/iOS avatar blobs, while keeping remembered login avatars protected.
- Moved the iOS native Firebase Storage upload adapter out of chat media and documented the local cache and pagination boundaries.
- Cleaned active todos and repo remarks by removing completed pagination/native-storage/chat-media/opaque-cutover tasks, narrowing server-abuse follow-up to the message send cap tradeoff, adding wallet-transfer notification follow-up, and reordering repo remarks by concern level.

## 0.14.0 - 2026-06-05

- Reset Veyl launch versioning back to the v0 line while preserving the current minor streams for repo and app packages.
- Moved web and iOS onto the shared Firebase cloud adapter and updated chat/provider wiring around the clean opaque chat data path.
- Reworked opaque chat lifecycle around backend-issued active chat ids, encrypted owner entries, sealed inbox pings, shared message TTL saves, chat media holds, and client-owned stale owner-entry pruning.
- Added whole-chat batch deletion for manual and account-delete flows, unthrottled chat marking, deleted-chat status checks, active-link clearing, and scheduled physical cleanup for deleted chat messages/media.
- Updated web, iOS, bot runtime, Firestore/Storage rules, Functions, cost model, and chat/security docs to match the current encrypted chat architecture.
- Cleaned active todo state and documentation around saved messages, presence, native storage/cloud adapters, pagination, chat media retention, and opaque chat cutover follow-ups.

## 4.14.13 - 2026-06-02

- Removed legacy chat-key push routing, the no-op chat deletion callable, wallet webhook cleanup paths, and the old participant-array Firestore index from the opaque chat backend.
- Replaced direct recipient inbox writes and the chat push trigger with a block-enforcing `push` callable that writes 21-day sealed inbox pings and sends username-based generic notifications.
- Reduced chat-list ping hydration reads by grouping inbox pings per chat, limiting ping batches, and reading at most one pointed message per touched chat per batch.
- Removed parent chat timestamp writes, direct message-rule moderation reads, established-send peer lookups, and broad owner-entry scans by treating opaque `chatId` access as participant authority and actor signatures as sender authority.
- Made visible-send queue coalescing write the owner entry and recipient inbox ping on the latest queued message per chat, while keeping receipts, reactions, and hidden checkpoints as message-only action docs.
- Restored hard message deletion and whole-chat deletion on the opaque chat model with direct message doc deletes and a rare `deleteChat` callable.
- Added verbose Firebase client logging and safe callable start/done/error logs for traffic runs across web, iOS, bot, and server actions.
- Cut push registration rate-limit churn with an idempotent device-token fast path, a single hourly push bucket, and shorter rate-limit TTL grace.
- Updated cost docs and the executable message-rate model for opaque owner entries, inbox pings, media stays, saved records, and current push costs.

## 4.14.12 - 2026-06-02

- Reworked chat storage around opaque pair-derived `chatId`s, owner-only encrypted chat entries, sealed inbox ping docs, and append-only encrypted action docs instead of participant arrays, plaintext sender fields, or shared preview state.
- Added per-chat cryptographic action envelopes for create, edit, delete, payment confirmation, reactions, receipts, hidden checkpoints, and settings, with actor signatures or shared action authenticators verified by clients.
- Moved saved-message state into owner-owned encrypted saved records and updated delete handling so source-doc deletes win over local saved copies and saved media holds.
- Updated Firestore rules, push functions, account/chat deletion paths, bot runtime, web, and iOS chat flows to use owner entries, inbox pings, pair chat selection, and opaque chat hydration.
- Documented the dumb-server, smart-cryptographic-client model across chat, security, repo, navigation, code, and active todo guidance.
- Cleaned up web payment peer/amount controls with a shared money amount input, selected-peer clear affordance, aligned trailing controls, and static peer profile headers.
- Split iOS peer picking into a reusable picker surface and kept camera/media staging paths aligned with the opaque media and upload-reservation rules.

## 4.14.11 - 2026-06-01

- Added public security reporting guidance and documented the Firebase client-config posture for open-source scanning.

## 4.14.10 - 2026-06-01

- Added Firebase App Check for the web client with a reCAPTCHA Enterprise key restricted to Veyl web domains.
- Added account-creation IP limits, account upload quotas, and Storage upload reservations for chat media and report evidence.
- Replaced global push-token cleanup scans with direct push owner docs for cheaper iOS push sync.
- Tightened chat Firestore rules with encrypted payload byte caps and documented the direct-write rate-limit boundary.
- Added Apache-2.0 licensing metadata for the repo.
- Removed the `veyl-oss` side-copy workflow in favor of making the canonical repo public.

## 4.14.9 - 2026-06-01

- Added the allowlisted `veyl-oss` client export shape and guarded sync tooling for `bun push oss`.
- Added curated public README and security-policy templates for the future client-only OSS repo.

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
