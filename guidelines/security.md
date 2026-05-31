# Security Guidelines

## Auth

- Accounts are company-wide.
- Passkeys are rooted at `glyphteck.com`.
- Local dev hosts should stay inside the `glyphteck.com` RP scope.
- When changing auth, check whether root-domain well-known files, Firebase Functions, web client route gates, and client passkey code also need updates.

## Vault And Secrets

- The vault password should never be known by Glyphteck Corp.
- The decrypted seed and derived wallet/chat secrets should stay client-side.
- Unlock happens locally.
- Vault lock should tear down wallet connections, zero the live chat private key where possible, clear provider state, and clear derived chat-pair caches.
- Vaulted local data cache keys are derived only after local seed decrypt, are never stored directly, and must be zeroed/closed on lock, failed unlock, auth switch, and provider unmount.
- The durable local cache must contain only ciphertext plus nonsensitive envelope metadata while the vault is locked. Do not put chat ids, public keys, usernames, message previews, transaction amounts, or peer lists in plaintext localStorage keys, IndexedDB indexes, AsyncStorage keys, or filenames.
- Cached chat media bytes must be stored as vault-encrypted blobs with opaque local ids. Storage paths, file keys, chat ids, public keys, filenames, captions, and media metadata belong only inside the encrypted local cache payload.
- Chat message lists must not be hydrated from durable local cache. The server is the source of truth for message existence, especially because either participant can delete messages at any time.
- In-memory recent-chat message batches are allowed only after unlock and must stay provider-owned session state. Do not persist those batches or expose plaintext local indexes. Warm message batches must not download attachment bytes; media reads should happen only from the normal render or user path after a server-confirmed message doc proves the attachment still exists.
- Media cache writes must not block first render after a Storage decrypt. Defer durable media writes, and use native platform crypto on iOS for large cached media blobs.
- Do not enable Firebase offline persistence as a substitute for the vaulted local cache. Its local store is not keyed to the vault password.
- Account deletion must clear the durable local cache before sign-out.
- When changing vault behavior, check secret lifetime across app open, app lock, app background, browser close, forced kill, and device restart.

## Chat

- Chat is custom encrypted 1:1 messaging over Firestore.
- Message payload shape is cross-platform and backend-sensitive.
- Chat IDs are derived from participant chat public keys.
- Messages are encrypted before storage.
- User read receipts, reactions, and hidden checkpoints are encrypted control payloads in the message stream (`t: 'rr'`, `t: 'rxn'`, and `t: 'hid'`). Do not add plaintext per-user read state, reaction state, hidden state, active-chat state, or retention mode to chat docs.
- Chat docs should only carry participants, an independent recency timestamp, the encrypted latest visible-message preview plus its `ttl`, and encrypted retention settings. Do not reintroduce plaintext read markers or plaintext chat preferences.
- Chat messages and other expiring backend records use a `ttl` timestamp field for deletion naming. `ttl: null` means the item is permanent unless another cleanup path deletes it.
- Chat retention settings are `seen` and `24h`; missing settings mean `24h`. Store them as encrypted chat settings because only participant clients need the value. Permanent storage is per-message, not a chat-wide retention setting.
- Never use `lastMsgTime`; `chat.ts` is the chat-row recency source of truth. `lastMsg` is only an encrypted preview plus `ttl` and can be removed when it is unreadable without changing chat ordering.
- Individual messages can be saved by changing `ttl` from a timestamp to `null` and unsaved by setting a fresh temporary `ttl`. Backend-visible message TTL stays dumb: new messages use the standard 21-day TTL and read handling must not shorten plaintext TTL. Client-side visibility and smart deletion are derived only after decrypting read receipts, retention payloads, and hidden checkpoints. Saved media messages carry encrypted random stays plus stay keys, while Firestore stores only opaque per-file stay counts and stay-key hashes so one unsaved message releases the Storage hold only after no saved message still points at the same object.
- Chat media uses opaque `media/{id}/main` Storage paths plus a 21-day lifecycle rule on `media/`. Do not reintroduce `chatmedia/{chatId}/...` paths or Storage metadata containing chat ids, message ids, user ids, usernames, or permanence state. Permanent media keeps the same path; Firestore stay counts are the source of truth, and a Cloud Storage temporary hold is only the derived lifecycle block.
- Because media stays are encrypted message-body state, app UI must delete whole chats and accounts through shared flows that collect stays before the server removes opaque message docs and release those holds after the delete succeeds.
- Message rendering must be resolution-gated: do not render a message before its encrypted payload and remote attachment source resolve. Drop unresolvable messages from visible lists and render replies to missing targets as the local unavailable preview.
- Do not broadly compact read receipts; older receipt timestamps define first-seen time for `24h after seen`.
- When changing chat media, check shared code, web, iOS, Storage rules, and any report/deletion behavior.

## Wallet

- veyl is non-custodial.
- Veyl wallet/backend data is pre-production unless the user says otherwise. Prefer clean wallet architecture changes over legacy compatibility branches or migrations, and only preserve old wallet data when explicitly requested.
- Wallet behavior depends on the locally derived seed.
- User-facing transfer flows must treat Bitcoin and blockchain transfers as irreversible.
- Wallet changes can touch vault boot, address derivation, transfer history, payment requests, and peer analytics.
- Wallet transaction history may hydrate from the vaulted local cache, but wallet balance must remain live-only and must come from Spark balance calls or wallet events.
- Spark Bitcoin privacy mode is on by default. The dormant `ghostWallet` setting remains valid in private user settings, but do not expose it in the app UI unless product direction changes. Keep privacy synced through `wallet.setPrivacyEnabled(...)`; Spark docs say this hides Bitcoin activity from public read-only lookups, but token transactions remain visible and wallet-owner/authenticated access still works.
- Wallet push notifications and Spark webhook registration are not active. Do not store static funding addresses or enable server-side deposit watching by default. Static Bitcoin deposit APNs require an explicit opt-in privacy tradeoff because the backend must know the address it watches. The server must never hold wallet seeds, claim signatures, Spark signers, or authenticated owner readonly access; the client remains the only deposit-claim executor.
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

Callable abuse control is enforced in Functions with `functions/lib/ratelimit.js`. Public passkey option and verify callables are limited per IP plus passkey origin, login options also limit requested account ids, and authenticated write-producing callables limit by uid. Rejections use `resource-exhausted` with retry details. The counter docs live in `rate_limits` with hashed identities only and a Firestore TTL on `ttl`; do not store raw IPs, origins, uids, credential ids, report targets, or request payloads in rate-limit docs.

Public profile moderation includes reserved and banned username filtering plus avatar bans. Keep username filtering aligned between onboarding, profile lookup, and admin docs; keep avatar-ban enforcement aligned across Storage rules, web admin moderation, admin commands, and iOS avatar upload UI.
