# Immutable Chat Messages

status: active
branch: current
worktree: current

## Scope

Remove encrypted message body mutation as a chat integrity primitive.

The current rules allow any participant to update a message `body` while keeping `head` and `ts` unchanged. Because both participants know the pair key, either side can reseal arbitrary plaintext under the original sender's `head.from`. Current app behavior depends on this for edits, save/unsave metadata, and payment request confirmation, so this needs a deliberate architecture change rather than a quick rules patch.

## Write Boundary

Expected owners:

- `firestore.rules`
- `shared/chat/messages/write.js`
- `shared/chat/actions/save.js`
- payment request confirmation flows on web and iOS
- message edit flows on web and iOS
- message hydration/rendering code that merges control messages with base messages

## Plan

- Make base message bodies immutable after create.
- Replace message edits with append-only encrypted edit/control messages, or a constrained server-visible edit field if product accepts that tradeoff.
- Replace save/unsave body rewrites with local-only saved state or separate owner-scoped state docs.
- Replace payment request confirmation body rewrites with append-only payment confirmation control messages.
- Keep `lastMsg` updates compatible with the new source of truth before tightening Firestore rules.
- After client behavior is migrated, change rules so participants cannot update message `body` at all.

## Handoff

Do not hard-block `body` updates until all current mutation flows have a replacement. The first test pass should cover send, edit, save, unsave, payment request, payment confirmation, reactions, read receipts, TTL changes, and last-message previews.
