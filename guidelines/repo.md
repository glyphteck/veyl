# Repo Guide

## What This Repo Is

Glyphteck Corp is the company.

This repo is the Veyl product workspace.

Main app surfaces:

- `apps/web`: the veyl web client
- `apps/ios`: the veyl iOS client
- `apps/bot`: the veyl bot runtime

Shared and backend packages:

- `shared`: shared workspace package `@veyl/shared`
- `functions`: Firebase Functions package with its own npm lifecycle

veyl is the first product. `veyl` is a codename and may change at launch.

veyl contains most product logic. The main user-facing product surfaces are the web client and iOS client.

## Package Shape

The root repo uses Bun.

The Bun workspace includes:

- `apps/*`
- `shared`

`functions/` is not part of the root Bun workspace. Install it separately with `npm install` inside `functions/`.

Package install, upgrade, lockfile, Expo SDK, and native rebuild rules live in [packages.md](packages.md). Use that guide before changing dependencies.

Repo-level automation lives in root `scripts/` and is exposed through Bun scripts. Do not add or rely on editor-specific workflow files for common repo operations. The old VS Code push/merge tasks are replaced by `scripts/repo.mjs` through `bun push` and `bun merge`.

Multi-agent planning, todo task files, branch/worktree decisions, handoffs, and cleanup live in [workflow.md](workflow.md). In short: stay on the current branch for small work, ignore unrelated dirty files, use one `todo/` task file for large or collision-prone work, and create a short branch plus linked worktree only when isolation materially lowers collision risk. If a worktree is used, record its path and branch in the task file. Do not use agent prefixes.

After a feature branch is merged, delete the merged branch and any abandoned predecessor branches. Then document the shipped behavior in the focused durable doc that owns it, matching the cleanup expected for completed work that started in `todo/`. Update `README.md` only when the human overview changes, and update `AGENTS.md` only when repo-wide agent rules change.

## Working Assumptions

- veyl web and veyl iOS are the main product surfaces.
- The `glyphteck.com` company website and root-domain static files live in the separate Website repo.
- Most core behavior belongs in `shared`, with only minor platform-specific differences in web and iOS.
- When behavior is unclear, inspect shared first, then compare the other client if the question is client-specific.
- When auth behavior is unclear, remember the root domain owns passkeys and account identity.

## Source Boundaries

- Web routes live in `apps/web/src/app`; web UI, providers, dialogs, and local primitives live in `apps/web/src/components`; web-only logic lives in `apps/web/src/lib`.
- Web `src/lib` is feature-folded into `admin`, `cache`, `chat`, `crypto`, `firebase`, `media`, `search`, and `user`, with small root platform helpers such as `passkey.js`, `routeguards.js`, `vault.js`, and `classes.js`.
- iOS routes live in `apps/ios/app`; iOS UI lives in `apps/ios/src/components`; provider wiring lives in `apps/ios/src/providers`; iOS-only logic lives in `apps/ios/src/lib`.
- iOS `src/lib` is feature-folded into `cache`, `camera`, `chat`, `crypto`, `navigation`, `search`, and `user`, with small root platform helpers.
- Shared cross-platform product logic lives in `shared` as `@veyl/shared`. Generic helpers are under `shared/utils/*`; feature logic is under owner folders such as `shared/chat`, `shared/wallet`, `shared/search`, `shared/cache`, `shared/navigation`, and `shared/bot`.
- `shared/cloud/firebase.js` is intentionally centralized as the current Firebase adapter. Keep Firebase-specific reads, writes, Storage, Functions, and paging details contained there until the backend provider boundary is replaced.
- Client encryption helpers emit raw `Uint8Array` encrypted blobs. Shared server-bound encrypted bodies use the `BODY_ENVELOPE_VERSION` byte envelope from `shared/crypto/pack.js`; cloud adapters own provider storage and transport encoding, such as Firestore `Bytes`, callable base64 payloads, SQL blobs, object bytes, or encoded text.
- Web UI no longer uses shadcn-generated primitive files. Keep Veyl-owned primitives under `apps/web/src/components`.
- Firebase Functions feature entrypoints live under `functions/passkey`, `functions/user`, `functions/chat`, `functions/wallet`, `functions/btc`, and `functions/admin`; deploy-local helpers live under `functions/lib`.
- Repo tooling lives under `scripts`, with admin command helpers in `scripts/admin`.

## Company-Wide Accounts

Accounts are company-wide.

Passkeys are rooted at `glyphteck.com` and are intended to work across company subdomains. A user account should work across:

- veyl main
- veyl test
- local dev hosts that stay inside the `glyphteck.com` RP scope

When working on auth, treat account scope as company-wide rather than app-specific.

## Product Model

veyl is not a wallet with chat added later, and not a chat app with payments added later.

The core product loop is:

1. authenticate with a passkey
2. create or unlock an encrypted vault
3. derive wallet and chat keys from the same local seed
4. send Bitcoin and communicate over encrypted chat

The unlocked vault also opens a local encrypted data cache for non-authoritative app state:

- chat entries
- decrypted chat media bytes
- peer profiles
- wallet transaction history

The cache exists to make unlock fast and reduce redundant expensive fetches. Message lists are not durable cache state; they must come from server-confirmed Firestore reads. Cached media bytes are used only after the server confirms the message document still exists. The cache is also not a source of spendable wallet truth; balances still come from live Spark calls and wallet events.

Local cache eviction uses `lastUsedAt` only for data where recency decides whether the client should keep a copy. Peer profiles age out after 30 days and are capped at 500 rows. Chat-list hydration is capped at 1,000 rows. Vaulted chat media uses least-recently-used encrypted blobs with hard item and byte caps. Platform avatar blob caches keep remembered-login avatars protected while normal cached avatars age out after 30 days and are capped by item and byte budgets.

## Architecture Principle

Veyl should move toward dumb server, smart cryptographic client.

The server should store and route opaque records, enforce cheap shape, quota, TTL, upload, and abuse limits, and avoid being the source of truth for private chat semantics. Clients should own semantic validity by holding user secrets, decrypting records, verifying signatures, checking action permissions, and deriving the renderable state.

This principle does not mean the server is useless. It can still provide transport, sync, storage lifecycle, rate limits, uploads, push triggers, public profile lookup, moderation surfaces, and future privacy-preserving mediation. If Glyphteck later owns custom server infrastructure, that server may participate in cryptographic protocols with users, but it should not become the default plaintext authority for private chat content, authorship, read state, payment-request state, per-user saved-message state, or wallet secrets.

## Data Model

Main Firestore collections:

- `users/{uid}`: private user data and settings
- `profiles/{uid}`: public profile data, wallet/chat public keys, presence
- `seeds/{uid}`: encrypted master seed
- `usernames/{username}`: username reservation. Usernames are currently one-time onboarding handles; `setUsername` rejects a second different username, and any future username change needs one deliberate callable that moves the reservation atomically.
- `links/{linkId}`: opaque pair link state with `links.chat.id`, `links.chat.version`, and `links.chat.ts` pointing at the current active chat instance.
- `chats/{chatId}/messages/{messageId}`: opaque active-chat action log. Parent chat docs are not app state except the delete cleanup tag; message docs carry encrypted signed actions with dumb TTL metadata. `ttl: null` means the shared message is saved/permanent. Owner chat entries live under `users/{uid}/chats/{entryId}`, and sealed inbox pings live under `users/{uid}/inbox/{pingId}`.
- `bitcoin/current`: public cached BTC price, block height, and compact fee-rate tiers watched by the app-level Bitcoin provider
- `passkeys/{credentialId}`: stored passkey credentials

Firebase Storage stores avatars, chat media, and report file blobs.

Device-local cache data is stored outside Firebase:

- iOS stores one encrypted local-cache blob plus opaque encrypted media blobs in app document storage.
- Web stores one encrypted local-cache blob plus opaque encrypted media blobs in IndexedDB.
- The shared payload and crypto helpers live in `shared/cache/localdata.js`.
- Only ciphertext is durable while the vault is locked, and account deletion clears the local cache.
