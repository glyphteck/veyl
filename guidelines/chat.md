# Chat System

Use this guide for any change to encrypted chat, chat rows, message payloads, retention, reactions, read receipts, media messages, warming, compaction, push routing, or bot chat behavior.

## Contract

- Chat is custom encrypted 1:1 messaging over Firestore. The server sees an opaque pair-derived chat id, owner paths, encrypted message envelopes, timestamps, TTL metadata, and sealed wake envelopes; it does not know participants from the canonical chat document, plaintext sender, message type, text, read state, reactions, retention mode, hidden state, or which message a saved media stay belongs to.
- The architecture principle is dumb server, smart client powered by cryptography. The server validates only auth, ban state, path ownership, and bounded document shapes. Clients derive pair ids, decrypt owner entries, pin per-chat actor keys, verify signed actions, and ignore anything that fails cryptographic verification.
- Chat ids are derived from the X25519 pair secret plus the ordered chat public keys. They are not sorted public-key strings and are not creator-random ids.
- User chat rows live in owner-only encrypted entries at `users/{uid}/chats/{entryId}`. `entryId` is derived from the owner's chat private material plus the opaque `chatId`, so simultaneous starts converge after decrypting the entry body.
- Message docs live at `chats/{chatId}/messages/{messageId}` and carry only `{ head, body, ts, ttl }`.
- `head` carries only an opaque client id (`cid`). Sender identity, action type, action target, actor key, and proof are inside the encrypted body.
- New unsaved display messages get a fixed 21-day Firestore TTL. Durable action docs use `ttl: null`. The backend TTL is deliberately dumb and must not be shortened because a read receipt arrived.
- Clients hide messages based on encrypted read receipts, encrypted per-message retention, and encrypted hidden checkpoints. Direct physical message update/delete is not a user feature in opaque v1.

## Direction

Long term, chat should use dumb server storage and smart cryptographic clients. As chat membership and sender identity become more opaque to the server, clients must verify actor-owned actions after decrypting instead of relying on Firestore Rules to understand who sent or may mutate a message.

The target primitive is a signed or authenticated encrypted chat action. The pair key makes the record private to participants; an actor signature proves which participant authored actions where identity matters once the signing-key publication model is chosen. A shared per-chat action authenticator can authorize operations where either participant may act and attribution is intentionally unnecessary. Renderers should accept edits, deletes, payment confirmations, reactions, receipts, hidden checkpoints, and retention changes only when the decrypted action verifies and the signer or authenticator is allowed for that action.

Do not turn personal state into chat-stream controls. Saving or unsaving a message is user-owned encrypted state, not a conversation event. Payment confirmation is different: it is a chat-visible fact owned by the payer and should be a signed action that references the original request rather than rewriting the request body.

Delete is also chat-visible global state. Either participant may delete any message for the chat; Veyl should not add a separate delete-for-me/local-hide product path.

## Payloads

- Display payloads: `txt`, `req`, `img`, `mp3`, `mp4`, `file`.
- Append-only action envelopes cover `create`, `edit`, `delete`, `pay_confirm`, `rxn`, `rr`, `hid`, and `sys`.
- Creates, edits, payment confirmations, reactions, read receipts, hidden checkpoints, and system rows are signed by the per-chat actor key derived from local vault material plus the pair-derived `chatId`.
- Edits apply only when the action actor is pinned for the original author. A peer cannot edit someone else's message without producing the original author's per-chat actor signature.
- Payment confirmation is a separate payer-signed `pay_confirm` action. Payment requests are not rewritten in place.
- Delete is an authenticated tombstone using the shared pair root. Either participant may delete any message in the shared chat, and a valid tombstone wins over saved state.
- Missing owner-entry settings mean `24h after seen`.

## Lifecycle

1. Sending encrypts the payload with the active per-chat retention mode embedded inside the message body.
2. The message action doc is written with a fixed 21-day `ttl` for display creates or `ttl: null` for durable action rows.
3. The parent `chats/{chatId}` doc stores only `{ v, ts }`. It is not a membership, settings, or preview source.
4. The sender updates their encrypted owner chat entry with local row data and writes a sealed wake to `users/{recipientUid}/chatInbox/{wakeId}`. The wake points to the global message doc and carries no message content.
5. The recipient decrypts the wake with their chat private key, verifies the pair-derived id/proof, checks the claimed sender uid owns the sender chat key, pins the sender actor key, creates or updates their owner chat entry, then subscribes to `chats/{chatId}/messages`.
6. Reading writes encrypted `rr` controls after a debounce. Controls do not update row previews and do not need plaintext server routing.
7. Visible user sends go through the existing soft client queue for UX pacing and cost control, not backend abuse control.
8. Visible message lists apply append-only actions and the encrypted retention timeline. `on seen` hides after the viewer releases the message; `24h after seen` hides after the first covering receipt is 24 hours old.
9. While a chat route is mounted, already-rendered rows are held visible so the UI does not erase messages under the user.
10. Firestore TTL remains a backup that eventually deletes unsaved display rows. Signed tombstones and owner saved records are the product source of truth.

## Saving And Media

- Saving a message writes an owner-owned encrypted record under `users/{uid}/savedMessages/{savedId}`. It does not mutate the shared message doc.
- Saved records store an encrypted message snapshot and any media stay data needed to survive normal message TTL.
- Unsaving deletes the owner saved record and releases the saved media stay when no longer referenced.
- A valid delete tombstone removes the rendered message, deletes matching owner saved records, and releases saved media holds after the client processes the tombstone.
- Saved media is protected separately with opaque media stay counts, stay-key hashes, and Cloud Storage temporary holds. Deleting or unsaving a saved media message must release its stay before deleting the message.
- Whole-chat and account deletion must be initiated through shared chat/account flows that collect owner saved-media stays before the owner entry or account data is removed, then release those holds after successful deletion. Do not call `deleteChat` directly from app UI.
- Storage paths must stay opaque `media/{id}/main` paths. Do not encode chat ids, message ids, user ids, usernames, or permanence state in paths or metadata.

## Query And Maintenance

- Message lists target about 20 post-retention readable messages. Foreground latest and older queries may overfetch only adaptively when control, hidden, expired, or unavailable messages prevent enough readable rows from resolving, and the foreground query cap is 60 docs.
- Warming is session-only provider state. It must not write message lists to durable cache and must not download attachment bytes.
- Client maintenance runs only after decrypting the opaque stream. Opaque v1 does not physically delete or rewrite shared message docs from user clients; it renders append-only actions and lets TTL/maintenance handle storage cleanup later.
- Do not broadly compact read receipts. Older receipt timestamps are the first-seen clock for `24h after seen`.

## Module Ownership

- Provider orchestration: `shared/providers/chatprovider.js`.
- Chat rows and row previews: `shared/chat/usechatlist.js`, `shared/chat/chats.js`, `shared/chat/rows.js`.
- Message query/decrypt/windowing: `shared/chat/messages/query.js`, `shared/chat/usemessages.js`, `shared/chat/messages/window.js`.
- Owner entries and inbox wakes: `shared/chat/entries.js`.
- Signed action envelopes: `shared/chat/messages/actions.js`.
- Saved message records: `shared/chat/saved.js`.
- Message session warming: `shared/chat/messages/session/`.
- Shared chat limits and timing knobs: `shared/config.js`.
- Payload/control helpers: `shared/chat/messages/*`.
- Writes: `shared/chat/messages/write.js`.
- Actions: `shared/chat/actions/*`.
- Whole-chat/account deletion and saved-media stay release: `shared/chat/actions/delete.js` plus owner saved-media collectors in `shared/chat/saved.js`.
- Media payloads/cache helpers: `shared/chat/filepayload.js`, `shared/chat/media.js`, `shared/chat/attachments.js`, platform media adapters.
- Push routing: `functions/chat/messagepush.js`.
- Bot runtime: `apps/bot/src/runtime.js`; keep it updated with chat lifecycle changes.

## Rules

- Keep the server dumb about encrypted message semantics.
- Prefer client-verifiable cryptographic ownership for chat-visible actions over server-readable author or participant checks when moving toward opaque chat.
- Do not add participants, plaintext sender keys, plaintext previews, read state, reaction state, retention mode, hidden state, or "currently in chat" state to `chats/{chatId}` docs.
- Do not reintroduce read-time plaintext TTL shortening.
- Do not make parent chat docs authoritative for chat existence, ordering, settings, or retention. Owner entries are the row source.
- When changing message lifecycle, update web, iOS, bot runtime, this guide, security guidance, Firestore rules if needed, and cost docs. Update `README.md` only if the human product overview changes.
