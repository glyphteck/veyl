# Chat System

Use this guide for any change to encrypted chat, chat entries, message payloads, retention, reactions, read receipts, media messages, warming, compaction, push routing, or bot chat behavior.

## Contract

- Chat is custom encrypted 1:1 messaging over Firestore. The server sees an opaque pair-derived chat id, owner paths, encrypted message envelopes, timestamps, TTL metadata, and sealed inbox ping envelopes; it does not know participants from the canonical chat document, plaintext sender, message type, text, read state, reactions, retention mode, hidden state, or which message a saved media stay belongs to.
- The architecture principle is dumb server, smart client powered by cryptography. The server validates only auth, ban state, path ownership, and bounded document shapes. Clients derive pair ids, decrypt owner entries, pin per-chat actor keys, verify signed actions, and ignore anything that fails cryptographic verification.
- Chat ids are derived from the X25519 pair secret plus the ordered chat public keys. They are not sorted public-key strings and are not creator-random ids.
- User chat entries live in owner-only encrypted entries at `users/{uid}/chats/{entryId}`. `entryId` is derived from the owner's chat private material plus the opaque `chatId`, so simultaneous starts converge after decrypting the entry body.
- Owner entry `ts` is a plaintext owner-visible list index for queries and pagination. It is not canonical message order; clients repair stale order after decrypting inbox pings and message actions.
- Message docs live at `chats/{chatId}/messages/{messageId}` and carry only `{ head, body, ts, ttl }`.
- `head` carries only an opaque client id (`cid`). Sender identity, action type, action target, actor key, and proof are inside the encrypted body.
- New unsaved display messages get a fixed 21-day Firestore TTL. Durable action docs use `ttl: null`. The backend TTL is deliberately dumb and must not be shortened because a read receipt arrived.
- Inbox pings are sealed delivery pointers with a fixed 21-day Firestore TTL. Once the recipient decrypts a ping, the durable memory of the chat lives in their encrypted owner entry.
- Clients hide messages based on encrypted read receipts, encrypted per-message retention, encrypted hidden checkpoints, and hard-deleted source docs. Direct physical message update is not a user feature in opaque v1.

## Direction

Long term, chat should use dumb server storage and smart cryptographic clients. As chat membership and sender identity become more opaque to the server, clients must verify actor-owned actions after decrypting instead of relying on Firestore Rules to understand who sent or may mutate a message.

The target primitive is a signed encrypted chat action. The pair key makes the record private to participants; an actor signature proves which participant authored actions where identity matters once the signing-key publication model is chosen. Renderers should accept edits, payment confirmations, reactions, receipts, hidden checkpoints, and retention changes only when the decrypted action verifies and the signer is allowed for that action.

Do not turn personal state into chat-stream controls. Saving or unsaving a message is user-owned encrypted state, not a conversation event. Payment confirmation is different: it is a chat-visible fact owned by the payer and should be a signed action that references the original request rather than rewriting the request body.

Delete is also chat-visible global state. Either participant may hard-delete any message for the chat; Veyl should not add a separate delete-for-me/local-hide product path.

## Payloads

- Display payloads: `txt`, `req`, `img`, `mp3`, `mp4`, `file`.
- Append-only action envelopes cover `create`, `edit`, `pay_confirm`, `rxn`, `rr`, `hid`, and `sys`.
- Creates, edits, payment confirmations, reactions, read receipts, hidden checkpoints, and system actions are signed by the per-chat actor key derived from local vault material plus the pair-derived `chatId`.
- Edits apply only when the action actor is pinned for the original author. A peer cannot edit someone else's message without producing the original author's per-chat actor signature.
- Payment confirmation is a separate payer-signed `pay_confirm` action. Payment requests are not rewritten in place.
- Delete physically removes the shared message doc. Either participant may delete any message in the shared chat by knowing the opaque `chatId`; the server does not verify participant identity.
- Missing owner-entry settings mean `24h after seen`.

## Lifecycle

1. Sending encrypts the payload with the active per-chat retention mode embedded inside the message body.
2. The message action doc is written with a fixed 21-day `ttl` for display creates or `ttl: null` for durable action docs.
3. Parent `chats/{chatId}` docs are not app state. Clients write and read the `messages` subcollection directly, and owner entries/inbox pings are the only chat-list indexes.
4. The sender updates their encrypted owner chat entry with local list data, then calls `push` with a sealed inbox ping for `users/{recipientUid}/inbox/{pingId}`. The ping points to the global message doc, carries no message content, and expires after 21 days.
5. The `push` callable enforces auth, sender chat bans, recipient block state, recipient existence, rate limits, and bounded ping shape, writes the sealed inbox ping, and sends a generic notification from the sender username.
6. The recipient decrypts the inbox ping with their chat private key, verifies the pair-derived id/proof, checks the claimed sender uid owns the sender chat key, pins the sender actor key, creates or updates their owner chat entry, then subscribes to `chats/{chatId}/messages`.
7. Reading writes encrypted `rr` controls after a debounce. Controls do not update chat previews and do not need plaintext server routing.
8. Visible user sends go through the existing soft client queue for UX pacing and cost control, not backend abuse control.
9. Visible message lists apply append-only actions and the encrypted retention timeline. `on seen` hides after the viewer releases the message; `24h after seen` hides after the first covering receipt is 24 hours old.
10. While a chat route is mounted, already-rendered messages are held visible so the UI does not delete messages under the user.
11. Message delete physically removes the message doc. Active listeners treat the removed source doc as the delete signal and clear local memory/cache.
12. Whole-chat delete uses the rare `deleteChat` callable to remove the caller owner entry, caller saved records, and the opaque chat doc/message subtree. Chat-banned users may still delete chats because deletion is private-data cleanup.
13. Firestore TTL remains a backup that eventually deletes unsaved display messages. Hard source deletes and owner saved records are the product source of truth.

## Saving And Media

- Saving a message writes an owner-owned encrypted record under `users/{uid}/savedMessages/{savedId}`. It does not mutate the shared message doc.
- Saved records store an encrypted message snapshot and any media stay data needed to survive normal message TTL.
- Unsaving deletes the owner saved record and releases the saved media stay when no longer referenced.
- A hard-deleted source doc removes the rendered message. The deleting client immediately deletes matching owner saved records and releases saved media holds; active listeners do the same when they observe the removed source doc.
- Saved media is protected separately with opaque media stay counts, stay-key hashes, and Cloud Storage temporary holds. Deleting or unsaving a saved media message must release its stay before deleting the message.
- Whole-chat and account deletion must be initiated through shared chat/account flows that collect owner saved-media stays before the owner entry or account data is removed, then release those holds after successful deletion. Do not call `deleteChat` directly from app UI.
- Storage paths must stay opaque `media/{id}/main` paths. Do not encode chat ids, message ids, user ids, usernames, or permanence state in paths or metadata.

## Query And Maintenance

- Message lists target about 20 post-retention readable messages. Foreground latest and older queries may overfetch only adaptively when control, hidden, expired, or unavailable messages prevent enough readable messages from resolving, and the foreground query cap is 60 docs.
- Warming is session-only provider state. It must not write message lists to durable cache and must not download attachment bytes.
- Client maintenance runs only after decrypting the opaque stream. Opaque v1 does not rewrite shared message docs from user clients; message delete is the one direct physical message mutation, while TTL/maintenance handle routine cleanup later.
- Do not broadly compact read receipts. Older receipt timestamps are the first-seen clock for `24h after seen`.

## Module Ownership

- Provider orchestration: `shared/providers/chatprovider.js`.
- Chat list and previews: `shared/chat/usechatlist.js`, `shared/chat/chats.js`, `shared/chat/list.js`.
- Message query/decrypt/windowing: `shared/chat/messages/query.js`, `shared/chat/usemessages.js`, `shared/chat/messages/window.js`.
- Owner entries and inbox pings: `shared/chat/entry.js` and `shared/chat/ping.js`.
- Signed action envelopes: `shared/chat/messages/actions.js`.
- Saved message records: `shared/chat/saved.js`.
- Message session warming: `shared/chat/messages/session/`.
- Shared chat limits and timing knobs: `shared/config.js`.
- Payload/control helpers: `shared/chat/messages/*`.
- Writes: `shared/chat/messages/write.js`.
- Actions: `shared/chat/actions/*`.
- Whole-chat/account deletion and saved-media stay release: `shared/chat/actions/delete.js` plus owner saved-media collectors in `shared/chat/saved.js`.
- Media payloads/cache helpers: `shared/chat/filepayload.js`, `shared/chat/media.js`, `shared/chat/attachments.js`, platform media adapters.
- Push routing: `functions/chat/push.js`.
- Bot runtime: `apps/bot/src/runtime.js`; keep it updated with chat lifecycle changes.

## Rules

- Keep the server dumb about encrypted message semantics.
- Prefer client-verifiable cryptographic ownership for chat-visible actions over server-readable author or participant checks when moving toward opaque chat.
- Do not add participants, plaintext sender keys, plaintext previews, read state, reaction state, retention mode, hidden state, or "currently in chat" state to `chats/{chatId}` docs.
- Do not reintroduce read-time plaintext TTL shortening.
- Do not write parent chat docs for chat existence, ordering, settings, or retention. Owner entries are the list source, and the message subcollection is the shared source namespace.
- Do not reintroduce delete tombstone action docs for normal message deletion. The source doc delete is the deletion source of truth.
- When changing message lifecycle, update web, iOS, bot runtime, this guide, security guidance, Firestore rules if needed, and cost docs. Update `README.md` only if the human product overview changes.
