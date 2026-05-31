# veyl Bots

## What Bots Are

Bots are normal veyl accounts with a backend runtime instead of a human behind the screen.

Every bot has:

- a real Firebase Auth user
- a `users/{uid}` doc (same as regular users)
- a `profiles/{uid}` doc with network-scoped `walletPKs`, `chatPK`, `username`, and a `bot` marker
- a `usernames/{username}` reservation
- a Spark wallet and an encrypted chat identity

Bots are deliberately stored in the same places as regular users. Regular users can find them, message them, send them money, block them, and report them without any special handling in the PeerProvider or chat system.

The only differences:

- no `seeds/{uid}` doc — the bot seed lives in Secret Manager
- a `bots/{uid}` control record for runtime state
- a `bot` custom claim on the Auth user
- a `bot` marker on `profiles/{uid}` (drives the bot avatar fallback)
- a backend Node process runs the bot headlessly

## Current Bot Behavior

When enabled, a bot:

- mirrors all incoming chat messages (text, attachments) back to the sender
- pays any incoming payment request if funded, then sends a mirrored request back for the same amount
- replies with an underfunded message if it can't afford a request
- appends encrypted read receipt and hidden-message checkpoint controls for the latest processed peer message before sending its mirrored reply, without changing the chat preview
- ignores encrypted control payloads such as read receipts, reactions, and hidden-message checkpoints
- keeps message TTL dumb like the clients: new messages use the standard 21-day TTL, saved messages use `ttl: null`, and the runtime does not shorten TTL after read handling
- accepts incoming transfers passively (balance updates automatically via Spark events)

Guardrails:

- disabled bots do nothing
- bot-to-bot loops are skipped
- blocked users do not get replies (checked both directions — bot blocked peer AND peer blocked bot)
- chat-banned users do not get replies
- chat-banned bots do not reply

## Reports and Moderation

Bots use the same UID-based systems as regular users:

- **Reports**: users report bots the same way they report anyone — `submitReport` writes to `reported/{botUid}`. The admin moderation dashboard shows bot reports.
- **Chat bans**: admins can chat-ban a bot via `moderation/{botUid}`. The bot runtime checks `isChatBanned(session.uid)` at message processing time and stops replying when banned.
- **Blocking**: users block bots via `users/{uid}/blocked/{botUid}`. The runtime checks both directions — if the bot has blocked the peer, or if the peer has blocked the bot — and skips replies in both cases.

## Implementation Components

### Runtime (`apps/bot/src/runtime.js`)

The core bot loop. `BotRuntime` is a long-lived process that:

1. subscribes to `bots` where `enabled == true` in Firestore
2. for each enabled bot, reads its profile for the active network wallet key and `chatPK`, boots a Spark wallet session, and subscribes to its chats
3. listens for Spark `transfer:claimed` and `balance:update` events to keep the admin-facing balance snapshot current
4. processes new peer messages in bot-owned chats by comparing timestamps against `seen` and `resumeAt`

Message handling:

- text messages: decrypted and mirrored back
- attachments: decrypted, re-encrypted under the bot's keys, uploaded as a fresh copy, and sent back
- payment requests: paid if the bot has sufficient balance, original request patched with the tx id, then a mirrored request sent back for the same amount
- read receipts: appended as encrypted `t: 'rr'` control messages before mirrored replies and sent without updating `lastMsg`
- hidden checkpoints: appended as encrypted `t: 'hid'` control messages with the bot read receipt, because the headless runtime has no chat UI to keep those messages visible
- reactions and incoming hidden checkpoints: encrypted control messages; skipped by the bot runtime instead of mirrored
- incoming transfers: accepted passively — Spark claims them automatically and the runtime refreshes the balance snapshot

Job serialization uses `queueMapJob` to ensure per-chat and per-wallet work runs sequentially without blocking other chats. The runtime also stores per-chat read checkpoints under `bots/{uid}/reads/{chatId}` and writes bot replies and bot-authored controls with deterministic message IDs derived from the source message, so a restart or retry cannot mirror the same source message into duplicate bot texts or duplicate bot read controls.

### Entry Point (`apps/bot/src/index.js`)

Starts the runtime process. Uses an atomic `.bot.lock` directory with a PID file to prevent duplicate local instances and a short Firestore lease at `runtimes/bot` to prevent two active runtimes against the same backend. A second runtime exits instead of stopping or replacing the active one. Handles `SIGINT`/`SIGTERM` for clean shutdown.

### Secrets (`apps/bot/src/secrets.js`)

Reads and writes bot seed material to Google Cloud Secret Manager. All bot seeds live in the single `veyl-bot-seeds` secret as a JSON `seeds` object keyed by username with base64-encoded seed bytes. Provides:

- `readBotSeed` — fetch the seed for a running bot
- `writeBotSeed` — store a new seed
- `ensureBotSeed` — read-or-create for provisioning
- `deleteBotSeed` — remove the username's seed entry from the bundle

### Admin / Firebase (`apps/bot/src/admin.js`)

Initializes `firebase-admin` for the bot process from platform/default credentials plus `FIREBASE_CONFIG` when present. Exports `db`, `Timestamp`, `FieldValue`, and `projectId`.

### Provisioning (`apps/bot/src/newbot.js`)

One-time bot account setup. Creates or reuses the Auth user, writes all Firestore identity records (`users`, `profiles`, `usernames`, `bots`), and stores the seed in Secret Manager.

When no username is provided, generates a random 12-character lowercase alphanumeric username and verifies uniqueness against the `usernames` collection before reserving it.

### Shared Bot Modules (`shared/bot/`)

- `account.js` — derives wallet and chat keys from a master seed, boots SparkWallet
- `chat.js` — encrypt/decrypt bot messages, send/update messages, handle attachment upload/download with a pair cache
- `wallet.js` — balance queries and outgoing transfers
- `events.js` — constants (`BOT_MODE`, `BOT_UNDERFUNDED_TEXT`, `BOT_SEEDS_SECRET_ID`), bot marker factory, seed key helpers
- `storage.js` — encrypted attachment read/write against Cloud Storage

### Wallet Environment

The bot is wallet-environment agnostic. The Spark network (`MAINNET` or `REGTEST`) is resolved at startup from the `NETWORK` environment variable (or `NEXT_PUBLIC_NETWORK` / `EXPO_PUBLIC_NETWORK`). The same bot code runs against either environment — just set the env var.

### Avatar

Bots that have no custom avatar show a bot icon instead of the default user silhouette. The `bot` marker on the profile drives this — the Avatar component checks it and renders the `Bot` icon (from lucide) as the fallback on both web and iOS.

## Firestore Data

### Normal account records (same as regular users)

- `users/{uid}` — standard account doc, block lists under `users/{uid}/blocked/{peerUid}`
- `profiles/{uid}` — public identity, avatar, network-scoped `walletPKs`, `chatPK`, presence, `bot` marker
- `usernames/{username}` — username reservation
- no `seeds/{uid}` — bot seeds are in Secret Manager

### Bot control record

- `bots/{uid}`
    - `uid`, `username`
    - `enabled` — power state
    - `mode` — behavior mode (`mirror`)
    - `status` — admin-readable runtime state
    - `balance` — admin-facing balance snapshot
    - `lastBootAt`, `lastRunAt`, `lastError`
    - `resumeAt` — replay cutoff when re-enabling
    - network-scoped `walletPKs`, `chatPK` — copied from the profile for runtime seed verification (avoids an extra Firestore read per boot)

### Moderation

- `moderation/{uid}` — same structure as regular users. Admins can ban bots from chat.
- `reported/{uid}` — users can report bots. Reports appear in the admin dashboard.

## Admin Control

Admins use `/bot` in the web app.

The admin UI can:

- list every bot
- inspect status, errors, keys, and balance
- toggle power on or off through `setBotPower`
- chat-ban or unban a bot

The CLI can do the same:

- `bun bot add [username]` — provision a bot (random username if omitted)
- `bun bot add <count>` — provision N bots with random usernames
- `bun bot power <@username|uid> on`
- `bun bot power <@username|uid> off`
- `bun bot burst [@username|uid]` — ask the running runtime to send a short deterministic message burst to a user; defaults to `@zxrl`, 60 messages, and a 3-second delay
- `bun bot b [@username|uid]` — short alias for `bun bot burst`
- `bun bot kill <@username|uid>` — fully delete the bot account
- `bun bot kill all` — delete every bot

## Operator Manual

### One-time setup

```bash
bun install
cd functions && npm install && cd ..
bun bot add @mybot
```

Or provision 10 bots with random usernames:

```bash
bun bot add 10
```

### Start the runtime

```bash
bun dev bot
```

One runtime serves all bots. Power control happens from `/bot` or `bun bot power`.

### Power a bot on or off

```bash
bun bot power @mybot on
bun bot power @mybot off
```

### Send a test burst

The bot runtime must already be running. The command queues an action for the live runtime and waits for completion by default:

```bash
bun bot burst
bun bot burst @alice --count 20 --delay 1s
bun bot b @alice --no-wait
```

The burst action sends plain text only, round-robins across enabled bot sessions, and tries one final encrypted read receipt per bot chat when there is a recent user-authored message to acknowledge.

### Delete a bot

```bash
bun bot kill @mybot
bun bot kill all
```

### Nuke bot backend refs

```bash
bun nuke bots @mybot   # one bot
bun nuke bots           # all bots
```

Removes `bots/{uid}`, `users/{uid}`, `profiles/{uid}`, `moderation/{uid}`, `usernames/*`, and chats containing the bot, plus associated bot avatar and chat media files. Does not delete the bundled seed entry or the Auth user.

### Test it

From a different account:

1. send a text message — mirrors back
2. send an attachment — mirrors back as a fresh upload
3. send sats to the bot — accepted, balance updates
4. send a payment request — paid if funded, mirrored request sent back

The bot runtime runs locally for testing. It will eventually move to a dedicated server and gain agency.

## Next Version

The current bot is intentionally small and deterministic. The next version is a real bot platform.

That version should add:

- bot templates and batch provisioning
- batch drain and delete flows
- a control plane for budgets, rate limits, policy, and kill switches
- separate agent workers for LLM reasoning
- strategy records for money-making behavior
- per-bot and per-cohort P&L, spend ceilings, and treasury controls
- durable inbox or queue infrastructure at scale
- secret rotation and fleet lifecycle tooling
