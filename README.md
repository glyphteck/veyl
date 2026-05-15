<p align="center">
  <img src="apps/veyl/web/public/wallet.png" alt="veyl" width="256">
</p>

<h1 align="center">veyl</h1>

This repo is the Veyl product workspace.

It contains the Veyl app surfaces:

- `apps/veyl/web`: the veyl web client
- `apps/veyl/ios`: the veyl iOS client
- `apps/veyl/bot`: the veyl bot runtime

The `glyphteck.com` company website lives in the separate Website repo. Veyl still depends on the company root domain for passkeys and public trust files.

Shared domains, origins, product links, local host names, passkey origins, app-link domains, and CORS origins are defined in `shared/links.js`. The generated reference is [links.md](links.md).

## Agent Guidelines

Agent-facing repo rules live in [guidelines/](guidelines/). Start with [AGENTS.md](AGENTS.md), then read the focused guideline files that match the task.

## Accounts

Accounts are company-wide.

Passkeys are rooted at `glyphteck.com` and are intended to work across company subdomains. A user should be able to make an account once and use it across:

- veyl main
- veyl test
- local development hosts inside the `glyphteck.com` RP scope

The root-domain passkey setup is shared so there is one account model across the company surface area.

## Product Model

veyl combines three things in one veyl:

- passkey-first account access
- a locally unlocked Bitcoin wallet powered by Spark
- end-to-end encrypted 1:1 chat

At a high level:

1. Register or sign in with a passkey.
2. Pick a username and optionally upload an avatar.
3. Create a vault password.
4. Encrypt a random master seed and store only the encrypted blob in Firestore.
5. Unlock locally with the password.
6. Derive:
    - a wallet seed for Spark
    - a chat keypair for encrypted messaging
7. Use veyl to send Bitcoin directly and message the counterparty over encrypted chat.

## What Exists

- Company-wide account access via passkeys
- Username onboarding
- Optional avatar upload
- Password-encrypted vault seed
- Spark wallet boot, balance, transfers, funding address, withdraw, and L1 claim veyl
- Custom encrypted 1:1 chat over Firestore
- Encrypted append-only chat read receipts
- Payment request messages inside chat
- Encrypted chat attachments for images, audio, video, and generic files
- Vaulted local cache for chat rows, chat media bytes, peer profiles, and wallet transaction history on iOS and web
- User settings such as money format and autolock
- Network-aware withdrawal guardrails for scans, QR routes, withdraw forms, and the shared wallet withdraw function
- Account deletion warnings that surface withdrawable balances and point users to withdraw/export paths before deletion
- Push notifications for new chat messages on iOS

Current chat payloads:

- `t: 'txt'` for text
- `t: 'req'` for payment requests
- `t: 'img'` for images
- `t: 'mp3'` for audio
- `t: 'mp4'` for video
- `t: 'file'` for generic attachments
- `t: 'rr'` for encrypted read-receipt control payloads

Chat attachments are encrypted before upload and are stored as file references plus encrypted keys/metadata in message documents. After a client decrypts an attachment, it can store the plaintext bytes in the device-local vault cache as a separate encrypted media blob. Read receipts are encrypted control messages in the same message stream; they do not update chat previews and are filtered out of visible chat UI.

## Architecture

### QR codes

veyl-specific QR codes are HTTPS wrappers at `/qr` on the active veyl web host. Use `shared/qrutils.js` to write and read them; do not emit raw `veyl:` strings or base64 JSON payloads.

Current QR structures:

- User: `${links.veyl}/qr?u=<username>`
- Payment request: `${links.veyl}/qr?r=<walletPK>&a=<sats>` (`a` is optional)
- Bitcoin funding address: `bitcoin:<address>`

For user QR codes, the username is the scanned account id. Do not encode Firebase UIDs in user QR codes.

The wrapper URL is intentional for veyl-specific actions. On iOS, the veyl web hosts are app links, so a system Camera scan opens veyl when it is installed. Without the app, the website can send mobile users to the download veyl, and desktop users go through the normal web auth/unlock path. Bitcoin funding QR codes intentionally stay standard `bitcoin:` URIs so external wallets can scan them directly.

### Identity and auth

- Firebase Auth is the auth backend.
- Passkey registration and login are handled by Firebase Functions using `fido2-lib`.
- `glyphteck.com` is the canonical passkey root and serves the root-domain well-known files.
- Web also issues an HTTP-only Firebase session cookie through Next.js route handlers.

### Vault and key derivation

- A random master seed is created on the client.
- The seed is encrypted with the user password and stored in `seeds/{uid}`.
- Unlock happens locally.
- The unlocked seed is split into:
    - a wallet seed
    - a chat seed
    - a local data-cache key

### Vaulted local cache

- iOS and web keep a device-local cache for chat rows, decrypted chat media bytes, peer profiles, and wallet transaction history.
- The cache is a vault feature. It is opened only after the vault seed is decrypted and is closed when the vault locks.
- The durable payload is AES-GCM ciphertext with AAD bound to cache version, user id, and wallet network.
- Chat media bytes are stored as separate AES-GCM media blobs with opaque local ids; the encrypted main payload stores the media index.
- Chat message lists are not cached as durable state. Visible messages must come from server-confirmed Firestore reads; cached media bytes are used only after the server confirms the message document still exists.
- iOS stores the encrypted main blob and media blobs in app document storage through `apps/veyl/ios/src/lib/localdatacache.js`.
- iOS also materializes decrypted media into a transient deterministic render-file cache under the app cache directory through `apps/veyl/ios/src/lib/msgimagecache.js`. That URI layer is separate from the vaulted media blob cache and can be rebuilt from the vaulted bytes after unlock.
- Web stores the encrypted main blob and media blobs in IndexedDB through `apps/veyl/web/src/lib/localdatacache.js`.
- Shared schema, crypto, timestamp revival, and cache helpers live in `shared/localdatacache.js`.
- The cache key is derived from the local master seed with a domain-separated label and is never stored in Keychain, SecureStore, IndexedDB, AsyncStorage, localStorage, or React state as raw key material.
- Wallet balance is not cached as authoritative state. Unlock may render cached transaction history immediately, but spendable balance still comes from fresh Spark balance calls and wallet events.
- Account deletion clears the durable local cache before sign-out.

### Wallet

- Wallet behavior is built around `@buildonspark/spark-sdk`.
- Peer payments use the other user’s stored `walletPK`.
- The app also tracks funding addresses, claims on-chain deposits, withdrawals, balance, and transfer history.
- Withdrawal flows must reject addresses that do not match the active wallet network. That check exists in scanner/QR entry points, form disabled states, and the shared wallet withdraw function.
- Transaction history hydrates from the vaulted local cache on unlock, then Spark pagination fetches recent pages until it reaches a stable cached transfer boundary. Balance remains live-only.

### Chat

- Chat is a custom encrypted 1:1 system on top of Firestore.
- Chat keys are X25519-derived.
- Messages are AES-GCM encrypted and stored as packed Firestore `Bytes`.
- Attachments are encrypted separately and stored in Firebase Storage. Message docs store encrypted attachment references and metadata, not plaintext file bodies.
- The iOS full-screen media viewer is owned by `apps/veyl/ios/src/providers/mediaviewerprovider.js`. Swipe navigation moves only the horizontal rail; vertical dismiss scale, opacity, rounding, and save-action fade are scoped to the active media slide so neighboring slides stay unscaled during exit.
- Chat IDs are derived from the two participant chat public keys.
- Chat list rows and previously decrypted media hydrate from the vaulted local cache after unlock, then Firestore listeners reconcile fresh chat-row data. Chat docs carry only participants and an encrypted latest visible-message preview (`lastMsg`) so list ordering, timestamps, previews, and push gating do not need one subcollection query per chat. Visible message lists still come from server-confirmed message reads, not the durable local cache.
- On iOS and web, chat warming keeps bounded in-memory latest-message batches for recent chats after unlock. Opening a warmed chat uses that provider-owned message batch as the initial message list instead of attaching a second latest-message listener or rendering an empty list first. The first chat row is warmed first because web lands there by default, but unlock navigation does not wait for warming. Media rows reuse the transient render-file cache before reading vaulted media again, and the warming path fills image/video media caches in the background only after server-confirmed message docs exist. These message batches are never written to the vaulted local cache and are cleared on lock/session teardown.
- Read receipts are encrypted `t: 'rr'` control messages appended to `chats/{chatId}/messages`. Clients derive read state after decrypting the stream, and outgoing message UI renders the latest peer receipt with the peer avatar.

### Backend and data

- Firebase Functions handle passkeys, onboarding writes, settings writes, push token registration, account deletion, reports, and scheduled BTC metadata refreshes.
- Firestore stores user state, public profiles, encrypted seeds, chats, messages, usernames, cached bitcoin metadata, and passkey records.
- Firebase Storage stores avatars and chat or report file blobs.

## Repo Layout

```txt
.
├── apps
│   └── veyl
│       ├── bot   Node bot runtime
│       ├── ios   Expo / React Native veyl client
│       └── web   Next.js veyl client
├── shared        Shared workspace package `@glyphteck/shared`
├── functions     Firebase Functions package (separate npm package)
├── firestore.rules
├── firebase.json
├── todo         One-file-per-feature active planning area
├── AGENTS.md
└── README.md
```

## Main Entry Points

If you want the quickest path into the codebase, start here:

- Web auth/session: `apps/veyl/web/src/app/api/auth/*`, `apps/veyl/web/src/lib/passkey.js`
- iOS auth: `apps/veyl/ios/src/lib/passkeys.js`
- Vault boot: `shared/vaultutils.js`
- Vaulted local cache: `shared/localdatacache.js`, `apps/veyl/ios/src/lib/localdatacache.js`, `apps/veyl/web/src/lib/localdatacache.js`
- Seed crypto: `shared/crypto/seed.js`
- Wallet provider factory: `shared/wallet.js`
- Chat provider factory: `shared/providers/chatprovider.js`
- Chat warming: `shared/chat/warming.js`
- Chat transport, crypto, and messages: `shared/chat/utils.js`, `shared/crypto/chat.js`, `shared/chat/messages.js`
- Shared user, peer, and tx providers: `shared/providers/*`
- Backend entrypoint: `functions/index.js`
- Security model: `firestore.rules`

## Data Model

Main Firestore collections:

- `users/{uid}`: private settings and per-user data
- `profiles/{uid}`: public profile info such as username, wallet/chat public keys, and presence
- `seeds/{uid}`: encrypted master seed
- `usernames/{username}`: username reservation
- `chats/{chatId}`: 1:1 chat metadata, including participants and encrypted last message preview
- `chats/{chatId}/messages/{messageId}`: encrypted user-visible messages and encrypted control payloads such as read receipts
- `bitcoin/current`: cached BTC price and block height
- `passkeys/{credentialId}`: stored passkey credentials
- `chatkeys/{chatPK}`: chat public key to uid lookup cache

## Local Development

The repo root is a pnpm workspace for app packages under `apps/*` and `apps/*/*`, plus the shared package under `shared`.

`functions/` is separate and uses npm, not the root workspace.

### Install

```bash
pnpm install
cd functions && npm install
```

### Run web

```bash
pnpm veyl web
pnpm veyl web mainnet
pnpm veyl web regtest
```

### Repo workflows

Repository push and merge workflows are pnpm CLI commands, not VS Code tasks:

```bash
pnpm push
pnpm merge
```

These commands prompt in the terminal, including arrow/Enter selection for version bumps and text prompts for required values. After the required inputs are collected, the workflow runs quietly and prints the pushed commit id when it succeeds. See [guidelines/commands.md](guidelines/commands.md) for flags and non-interactive examples.

Local web development uses hosted-style custom domains so local passkeys stay in the same `glyphteck.com` RP scope.

Map the local hosts from `shared/links.js` / [links.md](links.md) in `/etc/hosts`:

```txt
127.0.0.1 <domains.veylDev>
```

Then run the web app:

```bash
pnpm veyl web
```

The launcher applies the configured Veyl hostname, port, and HTTPS flags automatically.

If you need to override them manually, you still can:

```bash
pnpm veyl web --hostname <domains.veylDev> --experimental-https
```

Root-domain auth files live in the separate Website repo. App-owned Veyl web shell files such as the global stylesheet, loading screen, theme wrapper, and notifications live under `apps/veyl/web/src/app/*` and `apps/veyl/web/src/components/*`.

### Run iOS

```bash
pnpm veyl ios
pnpm veyl ios local
pnpm veyl ios mainnet
pnpm veyl ios regtest
pnpm veyl ios tunnel
pnpm build ios
pnpm build ios local
pnpm build backend
pnpm build db
pnpm build rules
pnpm build cors
pnpm build fns
```

`pnpm veyl ios local` installs/runs a standalone `veyl local` iOS build on `REGTEST` with bundle id `com.glyphteck.veyl.local`, so it can remain on a device separately from the normal dev build and does not require the Expo server after install. `pnpm build ios local` uses the same build type.

If native iOS dependencies change, refresh pods:

```bash
cd apps/veyl/ios/ios && pod install
```

## Configuration

Important environment and config points:

- `GOOGLE_SERVICE_ACCOUNT`: Firebase Admin service account JSON for server-side web auth, bot runtime, and backend helpers. Local development can use this env var or Google Application Default Credentials.
- `NEXT_PUBLIC_NETWORK`: web wallet network selection, typically `MAINNET` or `REGTEST`
- `EXPO_PUBLIC_EAS_PROJECT_ID` or `EXPO_PROJECT_ID`: optional iOS EAS project override

The Firebase client config is shared in `shared/firebaseconfig.js`.

## Bots

Bots are normal veyl accounts backed by a separate Node runtime under `apps/veyl/bot`.

The first bot is a deterministic account for Apple App Review on `domains.veylTest`. The bot runtime can mirror messages and attachments, pay payment requests when funded, append encrypted read receipts for viewed peer messages, and expose admin status/control through the web admin surface and `pnpm bot` CLI.

The later goal is to move bot operation from local/manual runtime management into dedicated hosted infrastructure with stronger scale, budget, lifecycle, and worker controls. AI-powered bot behavior is a later layer on top of the account model.
