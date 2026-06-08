# Ideas

This file is for dormant product, privacy, and architecture ideas that are worth preserving but are not active implementation tasks.

This is not the active task list. Move an idea into `todo/` only when it becomes a committed large feature or architecture project.

## LLM-Assisted Search

- Explore an optional search assistant only after cheap deterministic retrieval is exhausted.
- Keep indexed lookup as the source of truth for candidate rows; use an LLM, if ever needed, to rerank, explain, or answer when no product row is relevant.
- Do not stream the full user table into an LLM for real-time matching. That would be slower, more expensive, less deterministic, and harder to protect than local cache checks plus indexed profile queries.
- Useful future shapes could include semantic action search in the main menu, typo-tolerant intent routing, natural-language help answers, or "no exact result, but here is what you can do" responses.
- Gate any prototype behind strict latency, cost, privacy, and hallucination checks before it becomes part of search.

## Chat Presence

- Explore lightweight encrypted-chat presence only if a concrete UX, retention, or deletion-coordination problem needs it.
- Possible shapes include per-account, per-device, or per-chat-route presence with `active`, `updatedAt`, and stale timeout handling.
- Decide whether the signal should be visible to the other participant, used only locally, or both.
- Do not treat presence as the source of truth for seen state; encrypted read receipts remain the current seen-state mechanism.

## Mailbox Relay Chat Backend

- Explore replacing Firestore as the durable chat message stream with per-device encrypted mailboxes.
- The server would act as a payload relay: accept opaque encrypted envelopes, hold them only until each recipient device fetches them, then remove them from that device's mailbox.
- Message lifetime, disappearing-message timers, view-once behavior, read receipts, reactions, and chat history would become mostly client-owned encrypted state after delivery.
- This resembles Signal's store-and-forward model at a high level: encrypted messages are temporarily queued per device until fetched, and disappearing-message state is intentionally hidden from the service.
- Potential advantages: less server-retained chat history, no readable chat/message tree in storage, cleaner deletion after delivery, and less backend visibility into conversation state.
- Hard problems: multi-device catch-up, account recovery, new-device sync, retry of undecryptable messages, ordering, chat-list reconstruction, latest-message previews, unread state, reactions, read receipts, notifications, moderation/reporting, permanent messages, group expansion, offline retention limits, reliability, and migration.
- Veyl's vaulted local cache would help, but it would become the primary chat state after delivery. Losing a device or cache could lose history unless Veyl also builds a separate encrypted backup or sync layer.
- Permanent chats could exist as client-encrypted saved state or encrypted backup state, but that is a different architecture than keeping message docs in Firestore forever.

## Synthetic Data Blending

- Explore whether real backend records can be harder to distinguish by mixing them with large volumes of generated decoy data.
- Treat this as an anonymity-layer research idea, not a substitute for end-to-end encryption, local vaulting, strict rules, or minimal backend metadata.
- Prototype with fake user profiles, encrypted-looking chat envelopes, generated image/media attachments, fake report payloads, and wallet-like non-spendable metadata that never touches real Spark funds.
- Make decoys structurally indistinguishable from normal server records where possible: similar document sizes, timing patterns, attachment dimensions, storage paths, and lifecycle events.
- Keep all fake data clearly segregated at the trust boundary so clients never show it as real people, chats, media, balances, reports, or notifications.
- Model the cost and quota impact before implementation. Storage, Firestore reads/writes, indexes, CDN egress, moderation queues, and backup/export tooling could become the limiting factor.
- Define cleanup and expiry rules so generated data does not become permanent operational debt.
- Evaluate whether scheduled churn, delayed writes, dummy reads, or cover traffic gives more privacy value than static fake records.
- Review abuse, compliance, and moderation risks. Generated media and messages must not create reportable illegal content, spam another user, poison admin review queues, or mislead auditors.
- Measure privacy value honestly against simpler alternatives such as reducing plaintext metadata, opaque payload envelopes, batching writes, delaying presence, wallet rotation, and minimizing searchable indexes.
