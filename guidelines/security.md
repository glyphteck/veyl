# Security Guidelines

## Auth

- Accounts are company-wide.
- Passkeys are rooted at `glyphteck.com`.
- Local dev hosts should stay inside the `glyphteck.com` RP scope.
- When changing auth, check whether root-domain well-known files, Firebase Functions, session cookies, and client passkey code also need updates.

## Vault And Secrets

- The vault password should never be known by Glyphteck Corp.
- The decrypted seed and derived wallet/chat secrets should stay client-side.
- Unlock happens locally.
- Vault lock should tear down wallet connections, zero the live chat private key where possible, clear provider state, and clear derived chat-pair caches.
- Vaulted local data cache keys are derived only after local seed decrypt, are never stored directly, and must be zeroed/closed on lock, failed unlock, auth switch, and provider unmount.
- The durable local cache must contain only ciphertext plus nonsensitive envelope metadata while the vault is locked. Do not put chat ids, public keys, usernames, message previews, transaction amounts, or peer lists in plaintext localStorage keys, IndexedDB indexes, AsyncStorage keys, or filenames.
- Cached chat media bytes must be stored as vault-encrypted blobs with opaque local ids. Storage paths, file keys, chat ids, public keys, filenames, captions, and media metadata belong only inside the encrypted local cache payload.
- Chat message lists must not be hydrated from durable local cache. The server is the source of truth for message existence, especially because either participant can delete messages at any time.
- In-memory recent-chat message batches are allowed only after unlock and must stay provider-owned session state. Do not persist those batches or expose plaintext local indexes. Media warming may fill vaulted media caches only after a server-confirmed message batch proves the message doc still exists.
- Media cache writes must not block first render after a Storage decrypt. Defer durable media writes, and use native platform crypto on iOS for large cached media blobs.
- Do not enable Firebase offline persistence as a substitute for the vaulted local cache. Its local store is not keyed to the vault password.
- Account deletion must clear the durable local cache before sign-out.
- When changing vault behavior, check secret lifetime across app open, app lock, app background, browser close, forced kill, and device restart.

## Chat

- Chat is custom encrypted 1:1 messaging over Firestore.
- Message payload shape is cross-platform and backend-sensitive.
- Chat IDs are derived from participant chat public keys.
- Messages are encrypted before storage.
- User read receipts are encrypted append-only control payloads in the message stream (`t: 'rr'`). Do not add plaintext per-user read state to chat docs.
- Chat docs should only carry participants and the encrypted latest visible-message preview; do not reintroduce plaintext read markers.
- When changing chat media, check shared code, web, iOS, Storage rules, and any report/deletion behavior.

## Wallet

- veyl is non-custodial.
- Veyl wallet/backend data is pre-production unless the user says otherwise. Prefer clean wallet architecture changes over legacy compatibility branches or migrations, and only preserve old wallet data when explicitly requested.
- Wallet behavior depends on the locally derived seed.
- User-facing transfer flows must treat Bitcoin and blockchain transfers as irreversible.
- Wallet changes can touch vault boot, address derivation, transfer history, payment requests, and peer analytics.
- Wallet transaction history may hydrate from the vaulted local cache, but wallet balance must remain live-only and must come from Spark balance calls or wallet events.
- Withdrawal flows must reject addresses that do not match the active network at every entry point: scanner/QR handling, form validation and disabled state, and the shared wallet withdraw function.
- Account deletion UX must warn users when their balance is at or above the practical withdrawal minimum and keep withdraw/export paths visible before destructive deletion.

## Backend And Rules

When changing auth, chat, wallet, onboarding, uploads, reports, moderation, account deletion, or bots, check whether any of these need updates:

- `firestore.rules`
- `storage.rules`
- callable functions under `functions/`
- shared providers under `shared/providers/`
- account deletion cleanup
- moderation/reporting flows

Public profile moderation includes reserved and banned username filtering plus avatar bans. Keep username filtering aligned between onboarding, profile lookup, and admin docs; keep avatar-ban enforcement aligned across Storage rules, web admin moderation, admin commands, and iOS avatar upload UI.
