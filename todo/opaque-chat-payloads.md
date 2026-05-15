# Opaque Chat Payloads

Status: planned follow-up after the encrypted read-receipt rollout.

## Plan

- Keep the current encrypted message body shape: small payload objects with short `t` discriminators.
- Turn `shared/chat/messages.js` into the explicit registry for all user-visible and control payload types.
- Keep UI, bot, cache, push, report, and reply behavior keyed off shared helpers such as `canShowMsg`, `isControlMsg`, and future payload predicates.
- Avoid backend logic that branches on decrypted payload meaning. Backend should route encrypted envelopes, enforce metadata shape, and ignore application-level payload types.
- Review whether likes, payment request settlement, deletes, and future reactions should become append-only encrypted control payloads instead of body edits.
- Do not introduce full backend opacity yet; design the primitives so the server can later carry opaque client payload envelopes with less schema migration.
