# User Lifecycle

Use this guide when changing account creation, onboarding, vault unlock/lock, local cache lifetime, user-private chat state, push routing, blocking, or account deletion. Chat instance behavior lives in [chat.md](chat.md), message behavior lives in [msg.md](msg.md), and session behavior lives in [session.md](session.md).

## Account And Vault

The user account is company-wide, while wallet/chat secrets live in the local vault.

```mermaid
flowchart TD
    A["Passkey register or login"] --> B["Firebase auth session"]
    B --> C["Username and avatar onboarding"]
    C --> D["Create encrypted seed document"]
    D --> E["User enters vault password"]
    E --> F["Decrypt seed locally"]
    F --> G["Derive wallet key"]
    F --> H["Derive chat key"]
    H --> I["Publish public chat key in profile"]
    G --> J["Client-only wallet operations"]
```

Glyphteck stores encrypted app data and public profile metadata. Vault password, decrypted seed, wallet secrets, chat private keys, and derived local cache keys stay client-side.

## Unlock And Lock

Unlock creates live capabilities; lock tears them down.

```mermaid
flowchart TD
    A["Unlock succeeds"] --> B["Derive live chat and wallet material"]
    B --> C["Open vaulted local cache"]
    C --> D["Start providers"]
    D --> E["Hydrate owner-private state after decrypting"]
    E --> F["Use app"]
    F --> G["Lock, failed unlock, auth switch, unmount, or account deletion"]
    G --> H["Close wallet connections"]
    G --> I["Clear provider/session state"]
    G --> J["Zero live secrets where possible"]
    G --> K["Close and clear local cache handles"]
```

Durable local cache must contain only ciphertext plus nonsensitive envelope metadata while locked. Chat ids, public keys, usernames, message previews, transaction amounts, peer lists, media paths, file keys, filenames, captions, and media metadata do not belong in plaintext durable cache keys or filenames.

## Owner-Private Chat State

Owner-private chat state is stored under the user path and encrypted before storage.

```mermaid
flowchart TD
    A["Client knows active chatId"] --> B["Derive owner entryId from local chat secret"]
    B --> C["Encrypt owner chat entry"]
    C --> D["users/{uid}/chats/{entryId}"]
    E["Peer sends inbox ping"] --> F["users/{uid}/inbox/{pingId}"]
    F --> G["Client decrypts ping"]
    G --> H["Create or update owner chat entry"]
    H --> D
```

Owner entries are the chat-list source. Inbox pings are sealed 21-day delivery pointers, not duplicated message content.

## Push And Private Routing

Push delivery is the one normal chat path that still needs recipient-specific backend routing.

```mermaid
flowchart TD
    A["Sender builds sealed inbox ping"] --> B["push callable"]
    B --> C["Validate auth, sender ban, recipient block, recipient existence, rate limits"]
    C --> D["Write users/{recipientUid}/inbox/{pingId}"]
    D --> E["Send generic notification"]
    E --> F["Recipient decrypts ping after unlock"]
```

The backend can know sender auth uid and recipient uid for push routing. It must not receive plaintext message content, chat previews, read state, reaction state, retention state, payment state, or hidden state.

## Account Deletion

Account deletion is client-assisted while the vault is still unlocked because the backend cannot discover encrypted chat membership by itself.

```mermaid
flowchart TD
    A["User starts account deletion while unlocked"] --> B["Drain decryptable inbox pings into owner entries"]
    B --> C["Page decryptable owner chat entries"]
    C --> D["Call deleteChat in chunks for known chats"]
    D --> E["Clear local vaulted cache"]
    E --> F["deleteAccount callable"]
    F --> G["Delete user docs, profile, username, avatar, passkeys"]
    G --> H["Delete Firebase auth user"]
```

Account deletion waits for known chats to be marked deleted, not for every physical chat cleanup to finish. Scheduled cleanup retries pending chat message and media deletion.

## Ownership

- Auth and onboarding: web/iOS auth routes, passkey modules, profile/user providers.
- Vault boot/lock/cache: `shared/vault.js`, `shared/cache/localdata.js`, platform cache implementations.
- Owner chat entries and inbox pings: `shared/chat/entry.js`, `shared/chat/ping.js`, `shared/providers/chatprovider.js`.
- Push routing: `functions/chat/push.js`.
- Account deletion orchestration: `shared/chat/actions/delete.js`, `functions/user/actions/deleteaccount.js`, `functions/chat/deletechat.js`.
