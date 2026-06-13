# Chat System

Use this guide for any change to encrypted chat, chat entries, message payloads, retention, reactions, read receipts, media messages, warming, compaction, push routing, or bot chat behavior.

For lifecycle diagrams and ownership, read [lifecycle/secrets.md](../lifecycle/secrets.md), [lifecycle/msg.md](../lifecycle/msg.md), [lifecycle/chat.md](../lifecycle/chat.md), [lifecycle/batches.md](../lifecycle/batches.md), and [lifecycle/user.md](../lifecycle/user.md). [chat-message-flow.md](chat-message-flow.md) is only a compatibility pointer.

## Contract

- Chat is custom encrypted 1:1 messaging over Firestore. The server sees an opaque pair-derived link id, an active backend-issued chat id, owner paths, encrypted message envelopes, timestamps, TTL metadata, chat-scoped media paths, and sealed inbox ping envelopes; it does not know participants from the canonical chat document, plaintext sender, message type, text, read state, reactions, retention mode, or hidden state.
- The architecture principle is dumb server, smart client powered by cryptography. The server validates only auth, ban state, path ownership, and bounded document shapes. Clients derive link ids, decrypt owner entries, pin per-chat actor keys, verify signed actions, and ignore anything that fails cryptographic verification.
- Link ids are derived from the X25519 pair secret plus the ordered chat public keys. Active chat ids live at `links/{linkId}.chat.id`; the backend can issue a fresh active chat id after whole-chat delete without changing the pair-derived link. Message roots, action authenticators, and actor keys are scoped by active `chatId`, not by `linkId`.
- User chat entries live in owner-only encrypted entries at `users/{uid}/chats/{entryId}`. `entryId` is derived from the owner's chat private material plus the active `chatId`, so a recreated chat with the same peer gets a fresh owner entry.
- Owner entry `ts` plus the owner entry id is the plaintext owner-visible list marker for queries and pagination. It is not canonical message order; clients repair stale order after decrypting inbox pings and message actions.
- Owner entry `preview` is encrypted display/activity state for the chat list. Send-path owner preview writes belong to visible delivery messages and retention system messages. Reactions and read receipts stay stream-only controls; loaded clients may derive peer-useful preview text such as "liked your message" or "has seen your message" from the message stream without writing an owner-entry preview or inbox ping on send. Self-authored read receipts do not replace this user's message preview. Preview text and unread/foreground attention are separate decisions; reactions and read receipts can update preview text without making the row unseen.
- Message docs live at `chats/{chatId}/messages/{messageId}` and carry only `{ head, body, ts, ttl }`.
- `head` carries only an opaque client id (`cid`). Sender identity, action type, action target, actor key, and proof are inside the encrypted body.
- New unsaved display messages get a fixed 21-day Firestore TTL. Durable action docs use `ttl: null`. The backend TTL is deliberately dumb and must not be shortened because a read receipt arrived.
- Inbox pings are sealed delivery pointers with a fixed 21-day Firestore TTL. Once the recipient decrypts a ping, the durable memory of the chat lives in their encrypted owner entry.
- Clients hide messages based on encrypted read receipts, encrypted per-message retention, encrypted hidden checkpoints, and hard-deleted source docs. Direct physical message update is not a user feature in opaque v1.

## Direction

Long term, chat should use dumb server storage and smart cryptographic clients. As chat membership and sender identity become more opaque to the server, clients must verify actor-owned actions after decrypting instead of relying on Firestore Rules to understand who sent or may mutate a message.

The target primitive is a signed encrypted chat action. The pair key makes the record private to participants; an actor signature proves which participant authored actions where identity matters once the signing-key publication model is chosen. Renderers should accept edits, payment confirmations, reactions, receipts, hidden checkpoints, and retention changes only when the decrypted action verifies and the signer is allowed for that action.

Do not turn owner-private state into chat-stream controls. The current v1 save primitive is not owner-private: saving or unsaving is a shared message TTL toggle, not a per-user saved list, refcount, or signed chat action. Any participant can make a message permanent with `ttl: null` or temporary again with a fresh normal TTL, and the newest successful toggle defines server retention. Payment confirmation is different: it is a chat-visible fact owned by the payer and should be a signed action that references the original request rather than rewriting the request body.

Delete is also chat-visible global state. Either participant may hard-delete any message for the chat; Veyl should not add a separate delete-for-me/local-hide product path.

## Payloads

- Display payloads: `txt`, `req`, `img`, `gif`, `m4a`, `mp4`, `file`.
- `gif` is a first-class encrypted attachment payload, not an `img` fallback. It uses the same file-reference shape as other media payloads (`p`, `k`, optional `m`, `z`, `w`, `h`, `n`, `c`, `x`) while preserving the `gif` message type so renderers, replies, downloads, reports, and shared-media paths can keep animation behavior.
- GIF bytes stay client-owned chat media. Web and iOS preserve GIF files instead of normalizing them through static image compression, and the server still sees only encrypted file bytes plus opaque message envelopes.
- Append-only action envelopes cover `create`, `edit`, `pay_confirm`, `rxn`, `rr`, `hid`, and `sys`.
- Creates, edits, payment confirmations, reactions, read receipts, hidden checkpoints, and system actions are signed by the per-chat actor key derived from local vault material plus the active `chatId`.
- Edits apply only when the action actor is pinned for the original author. A peer cannot edit someone else's message without producing the original author's per-chat actor signature.
- Payment confirmation is a separate payer-signed `pay_confirm` action. Payment requests are not rewritten in place.
- Delete physically removes the shared message doc. Either participant may delete any message in the shared chat by knowing the opaque `chatId`; the server does not verify participant identity.
- Missing owner-entry settings mean `24h after seen`.

## Lifecycle Index

- Vault seed, public key, pair link, chat root, actor key, owner-entry, ping, and message-key derivation: [lifecycle/secrets.md](../lifecycle/secrets.md).
- Message send, media upload, save/unsave, explicit message delete, and shared media: [lifecycle/msg.md](../lifecycle/msg.md).
- Active chat ids, owner entries, parent delete markers, whole-chat delete, and recreation: [lifecycle/chat.md](../lifecycle/chat.md).
- Latest batches, warming, mounted route behavior, read receipts, hidden checkpoints, and maintenance: [lifecycle/batches.md](../lifecycle/batches.md).
- Account/vault state, owner-private records, push routing, and account deletion: [lifecycle/user.md](../lifecycle/user.md).

Keep this file focused on the chat contract, payload model, ownership map, and invariants. Put lifecycle diagrams and step-by-step sequencing in root `lifecycle/`.

## Module Ownership

- Provider orchestration: `shared/providers/chatprovider.js`.
- Secret and pair derivation: `shared/crypto/seed.js`, `shared/crypto/pair.js`, `shared/crypto/sign.js`, and `lifecycle/secrets.md`.
- Chat list and previews: `shared/chat/usechatlist.js`, `shared/chat/chats.js`, `shared/chat/list.js`.
- Message query/decrypt/windowing: `shared/chat/messages/query.js`, `shared/chat/usemessages.js`, `shared/chat/messages/window.js`.
- Owner entries and inbox pings: `shared/chat/entry.js` and `shared/chat/ping.js`.
- Signed action envelopes: `shared/chat/messages/actions.js`.
- Message batch warming: `shared/chat/messages/batches/`.
- Lifecycle diagrams: `lifecycle/`.
- Shared chat limits and timing knobs: `shared/config.js`.
- Payload/control helpers: `shared/chat/messages/*`.
- Writes: `shared/chat/messages/write.js`.
- Actions: `shared/chat/actions/*`.
- Whole-chat/account deletion: `shared/chat/actions/delete.js` and `functions/chat/deletechat.js`.
- Media payloads/cache helpers: `shared/chat/filepayload.js`, `shared/chat/media.js`, `shared/chat/attachments.js`, platform media adapters.
- Push routing: `functions/chat/push.js`.
- Bot runtime: `apps/bot/src/runtime.js`; keep it updated with chat lifecycle changes.

## Rules

- Keep the server dumb about encrypted message semantics.
- Prefer client-verifiable cryptographic ownership for chat-visible actions over server-readable author or participant checks when moving toward opaque chat.
- Keep `linkId` as a private rendezvous id. Do not derive message roots, action authenticators, or actor keys from `linkId`.
- Do not add participants, plaintext sender keys, plaintext previews, read state, reaction state, retention mode, hidden state, or "currently in chat" state to `chats/{chatId}` docs.
- Do not reintroduce read-time plaintext TTL shortening.
- Do not reintroduce per-user saved-message records, saved-message overlay listeners, saved-media hold docs, save refcounts, or plaintext save intent. Saved v1 is only shared message `ttl: null` plus the projected Storage temporary hold for chat media.
- Do not write parent chat docs for chat existence, ordering, settings, or retention. Owner entries are the list source, and the message subcollection is the shared source namespace.
- Do not reintroduce delete tombstone action docs for normal message deletion. The source doc delete is the deletion source of truth.
- When changing lifecycle behavior, update the relevant file under root `lifecycle/`, web, iOS, bot runtime, security guidance, Firestore/Storage rules if needed, and cost docs. Update `README.md` only if the human product overview changes.
