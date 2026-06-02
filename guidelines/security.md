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
- Chat message lists must not be hydrated from durable local cache. The server is the source of truth for message existence, especially because either participant can hard-delete messages at any time.
- In-memory recent-chat message batches are allowed only after unlock and must stay provider-owned session state. Do not persist those batches or expose plaintext local indexes. Warm message batches must not download attachment bytes; media reads should happen only from the normal render or user path after a server-confirmed message doc proves the attachment still exists.
- Media cache writes must not block first render after a Storage decrypt. Defer durable media writes, and use native platform crypto on iOS for large cached media blobs.
- Do not enable Firebase offline persistence as a substitute for the vaulted local cache. Its local store is not keyed to the vault password.
- Account deletion must clear the durable local cache before sign-out.
- When changing vault behavior, check secret lifetime across app open, app lock, app background, browser close, forced kill, and device restart.

## Chat

- Chat is custom encrypted 1:1 messaging over Firestore.
- Message payload shape is cross-platform and backend-sensitive.
- Chat IDs are derived from the X25519 pair secret plus ordered chat public keys. They must not reveal participant keys or be sorted public-key strings.
- The chat security model is dumb server, smart client powered by cryptography. The server checks owner paths, auth, sender bans and recipient blocks for inbox ping delivery, rate limits, and bounded shapes; clients derive pair ids, decrypt owner entries and inbox pings, pin per-chat actor keys, verify action signatures, and ignore invalid records.
- Messages are encrypted before storage.
- A pair-encryption key proves that one participant could create a ciphertext, but it does not prove which participant authored it. Message ownership, edits, and payment confirmations need actor signatures derived from user-held secrets, not from the pair key. Global message deletion is a hard source-doc delete authorized by knowing the opaque `chatId`.
- User read receipts, reactions, hidden checkpoints, edits, payment confirmations, and system actions are encrypted append-only actions in the message stream. Message deletion is a hard source-doc delete. Do not add plaintext per-user read state, reaction state, hidden state, active-chat state, edit state, payment state, delete state, or retention mode to chat docs.
- Parent `chats/{chatId}` docs are not app state. Do not reintroduce participants, plaintext sender keys, plaintext read markers, plaintext previews, plaintext chat preferences, or parent timestamp indexes there.
- User chat entries belong in owner-only encrypted `users/{uid}/chats/{entryId}` entries. Inbox pings belong in `users/{uid}/inbox/{pingId}` and must remain sealed 21-day delivery pointers, not duplicated message content.
- Chat messages and other expiring backend records use a `ttl` timestamp field for deletion naming. `ttl: null` means the item is permanent unless another cleanup path deletes it.
- Chat retention settings are `seen` and `24h`; missing owner-entry settings mean `24h`. Store them inside encrypted owner/action state because only participant clients need the value. Permanent storage is owner saved state, not a shared message mutation.
- Never use `lastMsgTime`; owner chat entry `ts` is the chat-list query index and can be repaired after decrypting pings/actions. Parent `chats/{chatId}.ts` must not be used or written as a list source.
- Individual messages are saved by writing owner-owned encrypted saved records, not by mutating the shared message doc. Backend-visible message TTL stays dumb: new display messages use the standard 21-day TTL and read handling must not shorten plaintext TTL. Client-side visibility is derived only after decrypting read receipts, retention payloads, hidden checkpoints, and signed/authenticated action docs.
- Delete physically removes the shared message doc. Either participant may delete any shared chat message; removed source docs hide the message, and clients remove matching owner saved records plus saved media holds when they observe the removal or initiate the delete.
- Chat media uses opaque `media/{id}/main` Storage paths plus a 21-day lifecycle rule on `media/`. Do not reintroduce `chatmedia/{chatId}/...` paths or Storage metadata containing chat ids, message ids, user ids, usernames, or permanence state. Permanent media keeps the same path; Firestore stay counts are the source of truth, and a Cloud Storage temporary hold is only the derived lifecycle block.
- Because media stays are encrypted owner/message state, app UI must delete whole chats and accounts through shared flows that collect owner saved-media stays before owner data is removed and release those holds after the delete succeeds.
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

Upload abuse control is enforced with server-minted reservations. Chat media and report evidence direct Storage creates must first call the matching reservation callable, which validates auth, path, content type, account age, and the shared time-window account-upload byte quota. New accounts are capped at 50 MiB/day; established accounts start at 250 MiB/day. Quota docs live in `usage_quotas` with hashed identities only, and reservation docs are short-lived TTL records read by Storage rules. Do not reopen direct `media/` or report-evidence Storage creates without a reservation check.

The web client initializes Firebase App Check with reCAPTCHA Enterprise before creating Firebase service clients. The reCAPTCHA Enterprise key is restricted to `veyl.glyphteck.com`, which also covers the test and dev subdomains; the Firebase web app's App Check config owns the risk threshold and token TTL. Do not enable App Check enforcement for shared Firebase products or callable functions until every supported client path, including iOS, can provide valid App Check tokens.

`shared/firebaseconfig.js` is public client configuration. The Firebase API key and web App Check site key identify the project/app and are allowed in source; they are not an authorization boundary. Keep the shared Firebase API key restricted to Firebase-related APIs only, and do not add application restrictions to that shared key while web and React Native iOS both use it. Use separate restricted keys for any non-Firebase Google APIs.

Direct Firestore message writes cannot maintain a true rate counter without another write/read or a callable send path. The zero-extra-write server guard is payload-size enforcement in Firestore rules for encrypted message bodies, owner entries, and saved records. Inbox ping delivery goes through the `push` callable so recipient blocks and rate limits are enforced before a user is notified.

Public profile moderation includes reserved and banned username filtering plus avatar bans. Keep username filtering aligned between onboarding, profile lookup, and admin docs; keep avatar-ban enforcement aligned across Storage rules, web admin moderation, admin commands, and iOS avatar upload UI.
