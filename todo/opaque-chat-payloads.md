# Opaque Chat Membership

Status: active design gate before implementation.

## Objective

Move chat membership out of server-visible chat documents and make `users/{uid}/chats/{entryId}` the only user-owned chat index. The server should not be able to read a chat document and learn which two user chat keys are in that chat.

This is a greenfield cutover. Do not add backward compatibility for existing chat rows, deterministic chat IDs, or legacy `participants` documents. Existing chats can be wiped before deploying the new shape.

## Current Leaks

- `chats/{chatId}.participants` stores both chat public keys.
- `chatId` is deterministic: sorted chat public keys joined together.
- Message and settings heads include plaintext `from`.
- Chat list queries use `where('participants', 'array-contains', userChatPK)`.
- Push, delete-account, delete-chat, bot runtime, cache, and UI helpers derive peers from `participants` or deterministic chat IDs.

## Target Shape

- `users/{uid}/chats/{entryId}` is the user's chat index.
- `entryId` is a random per-user ID, not the global `chatId`.
- The entry body is encrypted for that user and contains the global random `chatId`, peer chat key, local settings, and list ordering data needed by the client.
- `chats/{chatId}` uses a high-entropy random ID and does not store participants or chat public keys.
- `chats/{chatId}/messages/{messageId}` stores encrypted message envelopes with no plaintext sender key.
- Message sender identity stays inside encrypted payloads, so the client can still render and filter messages after decrypting.

## Minimal Flow

1. Chat creator generates a random `chatId`.
2. Chat creator writes their own encrypted chat entry under `users/{creatorUid}/chats/{randomEntryId}`.
3. Chat creator writes an encrypted invite/chat entry under `users/{peerUid}/chats/{randomEntryId}`.
4. Both clients read only their own `users/{uid}/chats` collection, decrypt entries after vault unlock, then subscribe directly to `chats/{chatId}/messages`.
5. Sending a message remains a direct Firestore write to the global chat message collection to avoid adding per-message Function cost.

## Required Crypto Primitive

Incoming chat entries cannot be encrypted with the recipient's normal pair key without revealing the sender public key in plaintext. The recipient would need the sender public key to derive the pair key.

Add an anonymous sealed invite primitive:

- Sender creates an ephemeral X25519 keypair for the invite.
- Sender encrypts the invite to the recipient chat public key using ephemeral private key plus recipient public key.
- Envelope stores only the ephemeral public key, nonce, and ciphertext.
- Recipient uses their chat private key plus the ephemeral public key to open the invite.
- Decrypted invite contains sender chat public key, random `chatId`, and initial chat metadata.

Own chat entries can use a self-only key derived from the user's vault/chat private material.

## Security Gate

With direct Firestore message reads and no server-visible participant list, Firestore Rules cannot prove that `request.auth.uid` is a member of `chats/{chatId}`. Rules cannot decrypt `users/{uid}/chats/{entryId}`, and making `entryId == chatId` would let an administrator join user docs by matching IDs.

The low-cost model therefore treats the random `chatId` as a bearer capability:

- A signed-in, non-banned user who somehow learns a valid random `chatId` can fetch that chat's ciphertext and can attempt to append valid-shaped ciphertext.
- They cannot list chats globally.
- They cannot decrypt messages without the chat key material.
- Clients must ignore undecryptable messages.

If this is not acceptable, the alternatives are:

- Keep some server-visible membership proof, which preserves strong Firestore authorization but leaks pair membership to the server.
- Route message reads and writes through Functions to verify opaque client capabilities, which increases per-message server cost and removes cheap realtime Firestore subscriptions.
- Duplicate messages into per-user chat paths, which hides pair links from global chat docs but increases per-message writes/storage and complicates sync.

## Push Gate

The current push trigger routes messages by resolving the deterministic chat pair on the server. A participant-opaque global chat document cannot tell the server which uid should receive push.

Options:

- Disable chat push for this cutover.
- Add a per-recipient encrypted wake/inbox write on each message so Functions can push to that uid. This adds per-message write and Function cost.
- Keep server-visible routing data for push, which violates the objective.

## Invite Write Gate

If the sender writes opaque invites directly to `users/{recipientUid}/chats/{entryId}`, Firestore Rules can validate envelope shape but cannot know the encrypted sender. That means Rules also cannot enforce recipient blocks against the sender or stop a signed-in user from writing valid-shaped opaque invite spam to another user's chat index.

Options:

- Accept direct opaque invite writes and handle abuse with coarse account/chat bans. This preserves server opacity and keeps per-message cost unchanged, but it weakens recipient-side blocking at invite creation.
- Route invite creation through a Function. This can enforce blocks and rate limits at per-chat-creation cost, but the server observes who is starting a chat with whom at creation time.
- Keep a server-visible invite sender field. This preserves direct Rules enforcement but leaks pair membership and violates the objective.

## Saved Media Delete Gate

Current account deletion can only release saved media stays by asking the unlocked client to scan/decrypt chat messages before the backend deletes the chats. The backend cannot discover those stays from opaque encrypted message bodies without a separate index.

Open decision: after the opaque chat redesign, decide whether saved media needs a user-owned encrypted saved-media index. That index would let account deletion release saved media without scanning all chat history, but it must not leak peer membership, message content, or attachment meaning to the server.

## Implementation Plan After Gate

1. Wipe existing chat data: `chats/*`, chat media references that depend on old chat IDs, bot chat state, and cached local chat rows if needed.
2. Add shared crypto helpers for random chat IDs, self-encrypted chat entries, and anonymous sealed invites.
3. Replace chat list loading with `users/{uid}/chats` encrypted-entry loading.
4. Replace deterministic `getChatId(chatPK, peerChatPK)` flows with random chat IDs from decrypted chat entries.
5. Remove plaintext `participants` and plaintext sender keys from chat docs, settings, last message, and message envelopes.
6. Update Firestore Rules to deny root chat listing and allow direct known-chat message access only under the accepted capability model.
7. Update send, media, retention, delete, cache, web, iOS, and bot call sites to carry `chatId` from the decrypted user chat entry.
8. Remove or redesign chat push and account/chat deletion logic according to the selected gate decision.
9. Deploy changed Firestore Rules and Functions targets after implementation.
