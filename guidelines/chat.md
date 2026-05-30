# Chat System

Use this guide for any change to encrypted chat, chat rows, message payloads, retention, reactions, read receipts, media messages, warming, compaction, push routing, or bot chat behavior.

## Contract

- Chat is custom encrypted 1:1 messaging over Firestore. The server sees chat ids, participants, encrypted message envelopes, timestamps, and TTL metadata; it does not know message type, text, read state, reactions, retention mode, hidden state, or which message a saved media stay belongs to.
- Chat ids are derived from the two participant chat public keys. Chat public keys come from the local vault seed and are published on profiles.
- Message docs live at `chats/{chatId}/messages/{messageId}` and carry only `{ head, body, ts, ttl }`.
- `head.from` and `head.cid` stay plaintext so clients can route, order, dedupe, and send pushes. `body` is encrypted and contains display payloads and control payloads.
- New unsaved messages get a fixed 21-day Firestore TTL. Saved messages use `ttl: null`. The backend TTL is deliberately dumb and must not be shortened because a read receipt arrived.
- Clients hide and then delete messages based on encrypted read receipts, encrypted per-message retention, and encrypted hidden checkpoints.

## Payloads

- Display payloads: `txt`, `req`, `img`, `mp3`, `mp4`, `file`.
- Read receipts: encrypted `rr` controls with `upto`.
- Reactions: encrypted `rxn` controls with `target` and optional `emoji`; the latest reaction per participant and target wins.
- Hidden checkpoints: encrypted `hid` controls with `upto`; they prove a participant's UI has released hidden messages up to that message.
- Retention setting rows: encrypted `sys` rows with `sys: 'retention'`; they are visible system rows and also establish the retention mode for later display messages.
- Missing `chat.settings` means `24h after seen`.

## Lifecycle

1. Sending encrypts the payload with the active per-chat retention mode embedded inside the message body.
2. The message doc is written with a fixed 21-day `ttl`, unless the user explicitly saves the message forever later.
3. The parent chat doc stores participants, independent recency `ts`, encrypted `lastMsg`, and encrypted `settings`. `lastMsg` is only a preview hint; `chat.ts` is the row ordering source of truth.
4. Reading writes encrypted `rr` controls after a debounce. Controls do not update `lastMsg` and do not trigger chat push.
5. Visible message lists apply the encrypted retention timeline. `on seen` hides after the viewer releases the message; `24h after seen` hides after the first covering receipt is 24 hours old.
6. While a chat route is mounted, already-rendered rows are held visible so the UI does not erase messages under the user.
7. After the UI releases hidden messages, the client writes an encrypted `hid` checkpoint. Checkpoints are a no-hole waterline and must not skip over an older hidden row still held visible.
8. A client may delete an unsaved received display message only after both participants' hidden checkpoints cover it. The receiver owns this smart delete to avoid duplicate delete churn.
9. Firestore TTL remains a backup that eventually deletes any unsaved message not cleaned up by clients.

## Saving And Media

- Saving a message changes its doc `ttl` to `null`.
- Unsaving restores a fresh temporary TTL based on the message's saved TTL, media expiry, or encrypted seen state.
- Saved media is protected separately with opaque media stay counts, stay-key hashes, and Cloud Storage temporary holds. Deleting or unsaving a saved media message must release its stay before deleting the message.
- Whole-chat and account deletion must be initiated through shared chat/account flows that collect saved media stays before the server deletes opaque message docs, then release the collected stays after successful deletion. Do not call `deleteChat` directly from app UI.
- Storage paths must stay opaque `media/{id}/main` paths. Do not encode chat ids, message ids, user ids, usernames, or permanence state in paths or metadata.

## Query And Maintenance

- Message lists target about 20 post-retention readable messages. Foreground latest and older queries may overfetch only adaptively when control, hidden, expired, or unavailable messages prevent enough readable rows from resolving, and the foreground query cap is 60 docs.
- Warming is session-only provider state. It must not write message lists to durable cache and must not download attachment bytes.
- Client maintenance runs only after decrypting the opaque stream. Safe deletes are expired TTL docs, mutually hidden received display messages, superseded reactions, duplicate read receipts with the same sender and target, old hidden checkpoints covered by newer checkpoints from the same sender, and retention setting rows replaced before any display message used them.
- Do not broadly compact read receipts. Older receipt timestamps are the first-seen clock for `24h after seen`.

## Module Ownership

- Provider orchestration: `shared/providers/chatprovider.js`.
- Chat rows and row previews: `shared/chat/usechatlist.js`, `shared/chat/chats.js`, `shared/chat/rows.js`.
- Message query/decrypt/windowing: `shared/chat/messages/query.js`, `shared/chat/usemessages.js`, `shared/chat/messages/window.js`.
- Message session warming: `shared/chat/messages/session/`.
- Shared chat limits and timing knobs: `shared/config.js`.
- Payload/control helpers: `shared/chat/messages/*`.
- Writes: `shared/chat/messages/write.js`.
- Actions: `shared/chat/actions/*`.
- Whole-chat/account deletion and saved-media stay release: `shared/chat/actions/delete.js` plus saved-media stay collectors in `shared/chat/messages/query.js`.
- Media payloads/cache helpers: `shared/chat/filepayload.js`, `shared/chat/media.js`, `shared/chat/attachments.js`, platform media adapters.
- Push routing: `functions/chat/messagepush.js`.
- Bot runtime: `apps/veyl/bot/src/runtime.js`; keep it updated with chat lifecycle changes.

## Rules

- Keep the server dumb about encrypted message semantics.
- Do not add plaintext read state, reaction state, retention mode, hidden state, or "currently in chat" state to chat docs.
- Do not reintroduce read-time plaintext TTL shortening.
- Do not make `lastMsg` authoritative for chat existence, ordering, or retention.
- When changing message lifecycle, update web, iOS, bot runtime, README, this guide, security guidance, Firestore rules if needed, and the cost docs.
