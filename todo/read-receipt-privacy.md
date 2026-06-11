# Read Receipt Privacy Setting

status: active
branch: current
worktree: current
base: main@fec7c7a6705e
repo version: 0.14.14

## Scope

Add a user setting that stops this user's clients from writing peer-visible read receipts into chats, so peers cannot infer that the user opened their messages.

This should not stop local read tracking. The client still needs to mark chats read for the current user, clear unread styling, cache read state, and avoid re-reading the same peer message as unseen.

## Current Shape

- User settings live in `shared/settings.js`, web settings in `apps/web/src/components/dialogs/settings.js`, and iOS settings in `apps/ios/app/(vault)/(app)/(home)/settings.js`.
- Local-private read state already exists as encrypted owner-entry `readMs` via `shared/chat/messages/write.js#setChatRead`.
- `shared/chat/actions/seen.js` currently does both jobs when a peer message is read: it updates owner-private read state with `setChatRead(...)` and optionally schedules `sendReadReceipt(...)`.
- `shared/chat/read.js#readCandidate` uses `readCacheRef` to avoid duplicate read work for a chat.
- Chat-list unseen state is already driven by owner-entry `readMs` in `shared/chat/chats.js#isChatUnseenForUser`, `applyReadCache`, `shared/chat/list.js`, and `shared/chat/inbox.js`.
- Peer-visible read receipts are encrypted stream controls with `t: 'rr'`; `sendReadReceipt(...)` writes them with `updatePreview: false` and `ping: false`.

## Repo Crawl Findings

- `shared/chat/actions/seen.js`
  - `markChatReadReceipt` is the main route-open path that writes both local `readMs` and the outbound `rr`.
  - `markChatRead` already supports local read without sending an `rr`.
  - The future setting should split these explicitly, not skip the whole read path.
- `shared/chat/usemessages.js`
  - On each active message window, it calls `getLatestOwnReadReceiptTarget(...)` and then `markChatRead(...)`.
  - It also calls `getLatestReadReceiptTarget(...)` and then `markChatReadReceipt(...)`.
  - If outbound `rr` is disabled, the `getLatestOwnReadReceiptTarget(...)` fallback becomes unreliable because there may be no self-sent receipt to rediscover.
- `shared/chat/usechatlist.js`
  - `applyBatchReadReceipt(...)` uses `getLatestOwnReadReceiptTarget(...)` to backfill owner-private `readMs` from self-sent `rr` controls in warmed batches.
  - This backfill should become optional or be replaced by direct owner-entry/read-cache hydration so preview unread state does not depend on self-sent `rr`.
- `shared/chat/messages/preview.js`
  - `canRenderChatPreview(...)` allows `rr` controls, so loaded clients can derive preview text such as "has seen your message".
  - With read receipts disabled, peers should simply stop getting this preview evidence.
- `apps/web/src/components/chat/messages/list.js`, `apps/web/src/components/chat/messages/row.js`, `apps/ios/src/components/chat/messages/list.js`, and `apps/ios/src/components/chat/receiptmark.js`
  - Receipt avatars/timestamps are derived from peer-authored `rr` controls using `getLatestReadOutgoingReceiptMessage(...)`.
  - These surfaces should naturally show no receipt mark when the peer has disabled read receipts.
- `shared/chat/messages/control.js`
  - `getLatestReadReceiptTarget(...)` prevents duplicate outbound `rr` writes by checking the latest self-sent receipt.
  - `getSeenHiddenMessages(...)` and `filterSeenMessages(...)` use `rr` controls to hide messages after seen.
- `shared/chat/messages/autodelete.js` and `shared/chat/messages/batches/cleanup.js`
  - Delete-after-seen cleanup depends on hidden checkpoints and read-receipt-derived hidden state.
  - If one side stops sending `rr`, peer-side cleanup and shared deletion for seen-retention messages may no longer advance for messages that only the private reader has opened.
- `apps/bot/src/runtime.js`
  - Bots deliberately read by default and send `rr`/`hid` controls independently of user settings. Do not change bot behavior unless the product decision explicitly includes bot accounts.

## Risk And Product Decisions

- Privacy mode must keep current-user unread state local and correct through `readMs`; do not make the chat list depend on self-sent `rr`.
- Peers should lose receipt marks and "has seen your message" previews for this user when the setting is off.
- The biggest unresolved decision is retention semantics:
  - If `rr` is the only shared proof of seen, disabling it means peers cannot know when their messages were seen, and delete-after-seen cannot remain symmetric for those peer messages.
  - A privacy-preserving implementation may need local-only hiding for the reader, while shared deletion waits for both sides' visible stream controls or a different encrypted private-retention design.
  - Do not fake seen state with plaintext server fields or chat parent docs.
- Read receipt settings should probably be per-account first, not per-chat, unless UX requires per-chat overrides later.

## Plan

1. Add a normalized setting in `shared/settings.js`, likely `sendReadReceipts: true` by default.
2. Surface the setting in web and iOS settings only after deciding the user-facing wording.
3. Thread the setting through `shared/providers/chatprovider.js` into `useChatSeen`.
4. In `useChatSeen`, always write owner-private `readMs` through `setChatRead(...)`, but only schedule `sendReadReceipt(...)` when the setting is enabled.
5. Replace or remove dependencies on self-sent `rr` for current-user read state:
   - `shared/chat/usemessages.js`
   - `shared/chat/usechatlist.js#applyBatchReadReceipt`
   - any warmed-batch read-cache backfill that assumes self-sent `rr` exists.
6. Keep peer receipt rendering unchanged; absence of peer `rr` should naturally mean no receipt mark.
7. Revisit delete-after-seen:
   - decide whether privacy mode disables shared seen-retention behavior for peer messages,
   - or introduce a local/private retention path that does not disclose read events.
8. Update `guidelines/chat.md` and the relevant lifecycle docs when implementation lands.

## Validation Notes

- Verify local unread clears on web and iOS with read receipts disabled.
- Verify the peer does not receive an `rr`, receipt avatar, or "has seen your message" preview.
- Verify current-user chat previews do not regress when opening, warming, deleting, or loading older chats.
- Verify delete-after-seen behavior explicitly; this is the likely breaking surface.
