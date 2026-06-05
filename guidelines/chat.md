# Chat System

Use this guide for any change to encrypted chat, chat entries, message payloads, retention, reactions, read receipts, media messages, warming, compaction, push routing, or bot chat behavior.

For the end-to-end send, media, receive, load, and maintenance diagrams, read [chat-message-flow.md](chat-message-flow.md).

## Contract

- Chat is custom encrypted 1:1 messaging over Firestore. The server sees an opaque pair-derived link id, an active backend-issued chat id, owner paths, encrypted message envelopes, timestamps, TTL metadata, chat-scoped media paths, and sealed inbox ping envelopes; it does not know participants from the canonical chat document, plaintext sender, message type, text, read state, reactions, retention mode, or hidden state.
- The architecture principle is dumb server, smart client powered by cryptography. The server validates only auth, ban state, path ownership, and bounded document shapes. Clients derive link ids, decrypt owner entries, pin per-chat actor keys, verify signed actions, and ignore anything that fails cryptographic verification.
- Link ids are derived from the X25519 pair secret plus the ordered chat public keys. Active chat ids live at `links/{linkId}.chat.id`; the backend can issue a fresh active chat id after whole-chat delete without changing the pair-derived link.
- User chat entries live in owner-only encrypted entries at `users/{uid}/chats/{entryId}`. `entryId` is derived from the owner's chat private material plus the active `chatId`, so a recreated chat with the same peer gets a fresh owner entry.
- Owner entry `ts` is a plaintext owner-visible list index for queries and pagination. It is not canonical message order; clients repair stale order after decrypting inbox pings and message actions.
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

- Display payloads: `txt`, `req`, `img`, `mp3`, `mp4`, `file`.
- Append-only action envelopes cover `create`, `edit`, `pay_confirm`, `rxn`, `rr`, `hid`, and `sys`.
- Creates, edits, payment confirmations, reactions, read receipts, hidden checkpoints, and system actions are signed by the per-chat actor key derived from local vault material plus the active `chatId`.
- Edits apply only when the action actor is pinned for the original author. A peer cannot edit someone else's message without producing the original author's per-chat actor signature.
- Payment confirmation is a separate payer-signed `pay_confirm` action. Payment requests are not rewritten in place.
- Delete physically removes the shared message doc. Either participant may delete any message in the shared chat by knowing the opaque `chatId`; the server does not verify participant identity.
- Missing owner-entry settings mean `24h after seen`.

## Lifecycle

1. Sending derives `linkId`, opens `links/{linkId}` through `cloud.chat.links.open`, and encrypts the payload for the active `links.chat.id` with the active per-chat retention mode embedded inside the message body.
2. The message action doc is written with a fixed 21-day `ttl` for display creates or `ttl: null` for durable action docs.
3. Parent `chats/{chatId}` docs are not app state. Clients write and read the `messages` subcollection directly, and owner entries/inbox pings are the only chat-list indexes. An absent parent chat doc is normal; a parent with `deleted` is the server kill marker.
4. The sender updates their encrypted owner chat entry with local list data, then calls `push` with a sealed inbox ping for `users/{recipientUid}/inbox/{pingId}`. The ping points to the global message doc, carries no message content, and expires after 21 days.
5. The `push` callable enforces auth, sender chat bans, recipient block state, recipient existence, rate limits, and bounded ping shape, writes the sealed inbox ping, and sends a generic notification from the sender username.
6. The recipient decrypts the inbox ping with their chat private key, verifies the pair-derived link id/proof, checks the claimed sender uid owns the sender chat key, pins the sender actor key, creates or updates their owner chat entry, then subscribes to `chats/{chatId}/messages`.
7. Reading writes encrypted `rr` controls after a debounce. Controls do not update chat previews and do not need plaintext server routing.
8. Visible user sends go through the existing soft client queue for UX pacing and cost control, not backend abuse control.
9. Visible message lists apply append-only actions and the encrypted retention timeline. `on seen` hides after the viewer releases the message; `24h after seen` hides after the first covering receipt is 24 hours old.
10. While a chat route is mounted, already-rendered messages are held visible so the UI does not delete messages under the user.
11. Message delete uses the `deleteChatMessage` / `deleteChatMessages` callables to remove the message doc and any chat media objects the client marks by message key. Active listeners treat the removed source doc as the delete signal and clear local memory/cache.
12. Whole-chat delete uses the rare unthrottled `deleteChat` callable with one chat target or a batch of chat targets. Each target carries `chatId`, optional `linkId`, and optional caller `entryId`. The callable tags every `chats/{chatId}` as deleted before cleanup starts and clears any supplied `links/{linkId}.chat.id`, so deleted chats become inaccessible and a new send to the same peer can get a fresh active chat id. The callable then wipes/deletes supplied caller owner entries. Normal manual chat delete also runs best-effort physical cleanup inside the callable; daily backend cleanup retries chat media storage and the opaque chat doc/message subtree. The delete tag stores no participant ids. If another participant still has an encrypted owner entry, their client deletes that owner entry when chat-list resolution, direct chat load, opening, or warming proves the shared chat is unavailable. Chat-banned users may still delete chats because deletion is private-data cleanup.
13. Account deletion is client-assisted while the vault is still unlocked. The client drains decryptable inbox pings into owner entries, pages through all decryptable owner chat entries, calls `deleteChat` in mark-only chunks, and only then calls `deleteAccount`. Account deletion waits for all known chats to be marked deleted, not for physical chat cleanup. The server-side account delete callable cannot discover encrypted chat membership by itself.
14. Firestore TTL remains the server cleanup source for temporary display messages. `ttl: null` on the shared message doc is the product source of truth for a saved message and makes that message ineligible for encrypted after-seen hide/delete cleanup until it is unsaved.

## Saving And Media

- Saving a message calls `setChatMessageTtl` to set the shared message doc `ttl` to `null`. Unsaving sets a fresh normal server TTL. There is no per-user saved-message Firestore list.
- The save control is global to the shared message. It is not per-user and there is no participant save count; any participant can save or unsave, and the newest successful toggle wins.
- Saving protects the message and its chat media from normal Firestore TTL, Storage lifecycle, and client-side after-seen cleanup. It does not protect against explicit message delete or whole-chat delete.
- Unsaving an old already-seen message does not restore the original expiry. It gets a fresh normal server TTL, then normal encrypted retention can hide it on route release and physical cleanup can delete it once both participants' hidden checkpoints cover it.
- Chat and shared media writes use short-lived signed upload URLs minted by the backend; Firebase Storage rules deny direct client creates for `chat-media/` and `shared/`.
- Saved chat media is projected from the same TTL toggle to a Cloud Storage temporary hold on `chat-media/{chatId}/{messageKey}/main`. No hold document stores a user id.
- Unsaving releases the message-level media hold after the message doc is temporary again. Storage lifecycle may then delete the media normally.
- A hard-deleted source doc removes the rendered message. The delete callables delete any client-marked chat media object by message key.
- Whole-chat delete tags the chat deleted immediately, blocks new saves for that chat, and cleanup removes the chat media prefix `chat-media/{chatId}/`, so saved media never survives a chat hard-delete.
- Sharing media uploads or reuses one expiring shared object under `shared/{sharedId}`. Destination messages reference the unguessable shared media id, not the source chat id. Shared media messages cannot be saved forever and explicit message delete does not delete the shared object.

## Query And Maintenance

- Message lists target about 20 post-retention readable messages. Foreground latest and older queries may overfetch only adaptively when control, hidden, expired, or unavailable messages prevent enough readable messages from resolving, and the foreground query cap is 60 docs.
- Chat-list resolution decrypts owner entries, batch-checks their opaque `chatId`s through `checkChats`, and deletes the user's own owner entries for chats whose parent is marked deleted. Missing parent docs remain active because active chats normally have no parent app-state doc.
- Warming is session-only provider state. It must not write message lists to durable cache and must not download attachment bytes.
- Client maintenance runs only after decrypting the opaque stream. Opaque v1 does not rewrite shared message docs from user clients; message delete is the one direct physical message mutation, while TTL/maintenance handle routine cleanup later.
- Message session maintenance runs after ready latest batches and on batch release, so warmed and opened chats share the same compaction owner. Control compaction can run on warmed batches; hidden-checkpoint writes are route-release work because they depend on visible-message holds.
- Route release first hides eligible seen temporary messages from the local view, then session maintenance may write this client's hidden checkpoint after current visible-message holds are known.
- Warmed/latest batches may still delete temporary display docs when both participants' hidden checkpoints already exist. They must not write this client's checkpoint; route release owns the current visible-message hold.
- A denied latest-message stream for a known chat is treated as an unavailable/deleted chat. The client deletes its own `users/{uid}/chats/{entryId}` record and drops local chat state; the server does not keep a plaintext reverse owner-entry index.
- Do not broadly compact read receipts. Older receipt timestamps are the first-seen clock for `24h after seen`.

## Module Ownership

- Provider orchestration: `shared/providers/chatprovider.js`.
- Chat list and previews: `shared/chat/usechatlist.js`, `shared/chat/chats.js`, `shared/chat/list.js`.
- Message query/decrypt/windowing: `shared/chat/messages/query.js`, `shared/chat/usemessages.js`, `shared/chat/messages/window.js`.
- Owner entries and inbox pings: `shared/chat/entry.js` and `shared/chat/ping.js`.
- Signed action envelopes: `shared/chat/messages/actions.js`.
- Message session warming: `shared/chat/messages/session/`.
- Message lifecycle diagrams: `guidelines/chat-message-flow.md`.
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
- Do not add participants, plaintext sender keys, plaintext previews, read state, reaction state, retention mode, hidden state, or "currently in chat" state to `chats/{chatId}` docs.
- Do not reintroduce read-time plaintext TTL shortening.
- Do not reintroduce per-user saved-message records, saved-message overlay listeners, saved-media hold docs, save refcounts, or plaintext save intent. Saved v1 is only shared message `ttl: null` plus the projected Storage temporary hold for chat media.
- Do not write parent chat docs for chat existence, ordering, settings, or retention. Owner entries are the list source, and the message subcollection is the shared source namespace.
- Do not reintroduce delete tombstone action docs for normal message deletion. The source doc delete is the deletion source of truth.
- When changing message lifecycle, update web, iOS, bot runtime, this guide, security guidance, Firestore rules if needed, and cost docs. Update `README.md` only if the human product overview changes.
