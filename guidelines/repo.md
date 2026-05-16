# Repo Guide

## What This Repo Is

Glyphteck Corp is the company.

This repo is the Veyl product workspace.

Main app surfaces:

- `apps/veyl/web`: the veyl web client
- `apps/veyl/ios`: the veyl iOS client
- `apps/veyl/bot`: the veyl bot runtime

Shared and backend packages:

- `shared`: shared workspace package `@glyphteck/shared`
- `functions`: Firebase Functions package with its own npm lifecycle

veyl is the first product. `veyl` is a codename and may change at launch.

veyl contains most product logic. The main user-facing product surfaces are the web client and iOS client.

## Package Shape

The root repo uses Bun.

The Bun workspace includes:

- `apps/*`
- `apps/*/*`
- `shared`

`functions/` is not part of the root Bun workspace. Install it separately with `npm install` inside `functions/`.

Repo-level automation lives in root `scripts/` and is exposed through Bun scripts. Do not add or rely on editor-specific workflow files for common repo operations. The old VS Code push/merge tasks are replaced by `scripts/repo.mjs` through `bun push` and `bun merge`.

Multi-agent planning, todo task files, branch/worktree decisions, handoffs, and cleanup live in [workflow.md](workflow.md). In short: stay on the current branch for small work, ignore unrelated dirty files, use one `todo/` task file for large or collision-prone work, and create a short branch plus linked worktree only when isolation materially lowers collision risk. If a worktree is used, record its path and branch in the task file. Do not use agent prefixes.

After a feature branch is merged, delete the merged branch and any abandoned predecessor branches. Then document the shipped behavior in durable docs such as `README.md`, `AGENTS.md`, or the focused guideline file, matching the cleanup expected for completed work that started in `todo/`.

## Working Assumptions

- veyl web and veyl iOS are the main product surfaces.
- The `glyphteck.com` company website and root-domain static files live in the separate Website repo.
- Most core behavior belongs in `shared`, with only minor platform-specific differences in web and iOS.
- When behavior is unclear, inspect shared first, then compare the other client if the question is client-specific.
- When auth behavior is unclear, remember the root domain owns passkeys and account identity.

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

- chat rows
- decrypted chat media bytes
- peer profiles
- wallet transaction history

The cache exists to make unlock fast and reduce redundant expensive fetches. Message lists are not durable cache state; they must come from server-confirmed Firestore reads. Cached media bytes are used only after the server confirms the message document still exists. The cache is also not a source of spendable wallet truth; balances still come from live Spark calls and wallet events.

## Data Model

Main Firestore collections:

- `users/{uid}`: private user data and settings
- `profiles/{uid}`: public profile data, wallet/chat public keys, presence
- `seeds/{uid}`: encrypted master seed
- `usernames/{username}`: username reservation
- `chats/{chatId}` and `chats/{chatId}/messages/{messageId}`: encrypted chat state. Chat docs carry participant metadata and encrypted `lastMsg`; user read receipts are encrypted append-only control payloads in the messages subcollection.
- `bitcoin/current`: cached BTC metadata
- `passkeys/{credentialId}`: stored passkey credentials
- `chatkeys/{chatPK}`: chat public key lookup cache

Firebase Storage stores avatars, chat media, and report file blobs.

Device-local cache data is stored outside Firebase:

- iOS stores one encrypted local-cache blob plus opaque encrypted media blobs in app document storage.
- Web stores one encrypted local-cache blob plus opaque encrypted media blobs in IndexedDB.
- The shared payload and crypto helpers live in `shared/localdatacache.js`.
- Only ciphertext is durable while the vault is locked, and account deletion clears the local cache.
