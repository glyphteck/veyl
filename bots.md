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

When enabled, every bot:

- reads incoming chat messages by default, even when it does not send a visible reply
- appends encrypted read receipt and hidden-message checkpoint controls for the latest processed peer message without changing the chat preview
- adopts peer retention system messages and peer-stamped message retention before writing replies
- uses peer read receipts only to append preview-neutral hidden-message checkpoints for bot-authored messages
- ignores other encrypted control payloads such as reactions and incoming hidden-message checkpoints
- keeps message TTL dumb like the clients: new messages use the standard 21-day TTL, saved messages use `ttl: null`, and the runtime does not shorten TTL after read handling
- accepts incoming transfers passively (balance updates automatically via Spark events)

Bots with the `echo` role mirror visible peer messages after the read receipt. `@echo` gets the `echo` role by default, but the role field remains authoritative so dropping `roles.echo` stops new echo behavior. Echo role behavior:

- mirrors incoming text messages and attachments back to the sender
- pays any incoming payment request if funded, then sends a mirrored request back for the same amount
- replies with an underfunded message if it can't afford a request

Canonical bots:

- `@faucet` is the canonical funding bot for other bots. Traffic funding uses it by default.
- `@echo` is the dedicated echo bot and gets the echo role by default.
- `@review` has the `review` role and also has the `echo` role for now, so review-specific behavior has a separate owner while the current visible behavior stays deterministic.

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
4. watches bot-owned chats plus their latest message docs, then processes new peer messages and preview-neutral controls by comparing timestamps against `seen` and `resumeAt`
5. applies changed `roles` and `restartAt` fields from the live bot subscription without restarting the whole runtime

Message handling:

- text messages: decrypted, read, and mirrored back only when the bot has the echo role
- attachments: decrypted, read, and mirrored as a fresh encrypted upload only when the bot has the echo role
- payment requests: read by every bot; echo bots pay if funded, patch the original request with the tx id, then send a mirrored request for the same amount
- retention: peer retention system messages and peer-stamped message retention update the bot-owned chat entry, so bot replies use the same delete-after-seen mode as the peer side
- read receipts: appended as encrypted `t: 'rr'` control messages for readable peer messages and sent without updating the chat preview
- hidden checkpoints: appended as encrypted `t: 'hid'` control messages with the bot read receipt, and again when a peer read receipt covers bot-authored messages, because the headless runtime has no chat UI to keep those messages visible
- reactions and incoming hidden checkpoints: encrypted control messages; skipped by the bot runtime instead of mirrored
- incoming transfers: accepted passively — Spark claims them automatically and the runtime refreshes the balance snapshot

Job serialization uses `queueMapJob` to ensure per-chat and per-wallet work runs sequentially without blocking other chats. The runtime also stores per-chat read checkpoints under `bots/{uid}/reads/{chatId}` and writes bot replies and bot-authored controls with deterministic message IDs derived from the source message, so a restart or retry cannot mirror the same source message into duplicate bot texts or duplicate bot read controls. `restartAt` is part of the live session key, so `bun bot restart ...` restarts selected bot sessions without power-cycling the whole runtime.

### Entry Point (`apps/bot/src/index.js`)

Starts the runtime process. Uses an atomic `.bot.lock` directory with a PID file to prevent duplicate local instances and a short Firestore lease at `runtimes/bot` to prevent two active runtimes against the same backend. A second runtime exits instead of stopping or replacing the active one. Handles `SIGINT`/`SIGTERM` for clean shutdown.

### Secrets (`apps/bot/src/secrets.js`)

Reads and writes bot seed material to Google Cloud Secret Manager. All bot secrets live in the single `veyl-bot-seeds` secret as a JSON `seeds` object keyed by username. Each entry is a v3 bot secret containing a base64 master seed plus the sealed secret registry, so bot wallet/chat derivation uses the same registry shape as user vaults after unlock. Provides:

- `readBotSecret` — fetch the v3 bot secret for a running bot
- `writeBotSecret` — store a v3 bot secret
- `ensureBotSecret` — read-or-create for provisioning
- `deleteBotSeed` — remove the username's seed entry from the bundle

### Admin / Firebase (`apps/bot/src/admin.js`)

Initializes `firebase-admin` for the bot process from platform/default credentials plus `FIREBASE_CONFIG` when present. Exports `db`, `Timestamp`, `FieldValue`, and `projectId`.

### Provisioning (`apps/bot/src/newbot.js`)

One-time bot account setup. Creates or reuses the Auth user, writes all Firestore identity records (`users`, `profiles`, `usernames`, `bots`), and stores the v3 bot secret in Secret Manager.

When no username is provided, generates a random 12-character lowercase alphanumeric username and verifies uniqueness against the `usernames` collection before reserving it.

### Shared Bot Modules (`shared/bot/`)

- `account.js` — opens the sealed registry, derives wallet and chat keys, boots SparkWallet
- `chat.js` — encrypt/decrypt bot messages, send/update messages, handle attachment upload/download with a pair cache
- `wallet.js` — balance queries and outgoing transfers
- `events.js` — constants (`BOT_MODE`, `BOT_UNDERFUNDED_TEXT`, `BOT_SEEDS_SECRET_ID`), bot marker factory, seed key helpers
- `roles.js` — canonical bot usernames, bot role tags, default memberships, and runtime predicates. Roles are currently bot-only behavior designations and can grow into a broader user-role model later.
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
- no `seeds/{uid}` — bot secrets are in Secret Manager

### Bot control record

- `bots/{uid}`
    - `uid`, `username`
    - `enabled` — power state
    - `mode` — behavior mode (`mirror`)
    - `roles` — runtime bot roles such as `traffic`, `echo`, and `review`
    - `status` — admin-readable runtime state
    - `balance` — admin-facing balance snapshot
    - `lastBootAt`, `lastRunAt`, `lastError`
    - `resumeAt` — replay cutoff when re-enabling
    - `restartAt` — session restart token for one bot or a role cohort
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
- `bun bot role <@username|uid|all|role:name> <traffic|echo|review> <on|off>` — subscribe or unsubscribe bot roles during a live runtime
- `bun bot sub <@username|uid|all|role:name> <traffic|echo|review>` — short form for enabling a role
- `bun bot unsub <@username|uid|all|role:name> <traffic|echo|review>` — short form for disabling a role
- `bun bot restart <@username|uid|all|role:name>` — restart selected bot sessions without stopping the runtime
- `bun bot traffic [mixed/tx/msg/chat] [@username/uid] [fast/slow]` — queue runtime-owned client load traffic; defaults to mixed message/transfer traffic for `@zxrl`
- `bun bot traffic mixed [@username/uid] [fast/slow]` — queue message and 1-sat transfer traffic in parallel
- `bun bot traffic msg|chat [@username/uid] [fast/slow] [--solo] [--source @botname]` — send message traffic only, optionally pinned to one bot-owned chat
- `bun bot traffic tx [@username/uid] [fast/slow]` — send 1-sat transfer traffic only
- `bun bot traffic fund [--source @faucet] [--target 1000]` — send a flat funding transfer to each enabled traffic-role bot
- `bun bot traffic label [@username|uid|all] [on|off]` — set the internal `roles.traffic` marker used by traffic commands
- `bun bot traffic stop` — request cancellation for queued/running traffic actions; restarted runtimes also cancel stale queued/running traffic actions before accepting new work
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

### Traffic load testing

Traffic commands are for client load testing. The bot runtime must already be running. The runtime uses enabled bots whose `bots/{uid}.roles.traffic` marker is `true`. `@faucet`, `@echo`, and `@review` stay out of the traffic role by default. Traffic bots also get `roles.echo = true` for now.

Start verbose runtimes before observing clients:

```bash
bun dev -v
```

Open and unlock web and iOS as `@zxrl`, then keep the relevant surface in view. Use the chat list for message traffic and the wallet transfer list for transfer traffic. Web may lock again after reload, so unlock it again before judging logs.

Fund the traffic fleet from `@faucet`:

```bash
bun bot traffic label all
bun bot traffic fund
bun bot traffic fund --target 1000 --source @faucet
```

`traffic label all` applies the canonical defaults: ordinary bots become traffic+echo bots, `@review` keeps echo+review roles, `@echo` keeps echo-only role, and `@faucet` stays outside traffic and echo. Funding sends the flat target amount from `@faucet` to each enabled traffic-role bot. It does not inspect balances or top up to a threshold. `--amount` is accepted as the same per-bot amount when that reads more clearly. Use it before transfer traffic when the fleet needs sats.

Queue mixed traffic:

```bash
bun bot traffic
bun bot traffic mixed @alice fast --count 50
bun bot traffic mixed @alice slow --duration 10m --no-wait
```

`fast` uses a 500ms delay and `slow` uses a 5s delay. Without a speed preset, traffic uses the default 3s delay. Message traffic shuffles enabled traffic-role bot sessions, covers each active bot once before repeating, then uses shared text-vs-request weights. Text messages come from the shared 100-item traffic-msg pool. Requests use weighted amount buckets from 1,000 to 1,000,000 sats, with most requests in the 10,000-99,999 sat range and fewer larger asks. The runtime still tries one final encrypted read receipt per bot chat when there is a recent user-authored message to acknowledge.

Queue focused traffic:

```bash
bun bot traffic chat @alice fast --count 60
bun bot traffic chat @alice fast --solo --source @mybot
bun bot traffic tx @alice fast --count 300 --no-wait
```

`msg` and `chat` both send message traffic. `msg --solo` or `chat --solo` sends every message through one bot-owned chat, either the requested `--source` bot or the first active traffic bot. Transfer traffic always sends 1 sat per transfer. Each transfer action randomly picks a traffic bot for every transfer and records sender counts plus tx ids in the action result when Spark returns them. For message, mixed, and transfer traffic, `--duration` derives the count from the selected delay and is capped by the shared traffic maximum.

Stop queued or running traffic cleanly:

```bash
bun bot traffic stop
```

Use `stop` before changing the traffic shape or restarting runtimes. Runtime startup also cancels stale queued/running traffic actions so a previous run cannot keep leaking work into the next observation pass.

Traffic action results keep the useful debugging data even when individual sends fail: requested count, sent count, sender distribution, tx ids where available, failure count, sampled failure messages, and cancellation state.

If a wallet transfer list shows rows that the unlocked wallet does not own, stop traffic before debugging and treat local encrypted transfer cache as suspect first. Cached transfer history must be scoped to the current wallet public key, and clients must reject cache rows whose sender and receiver keys do not include that wallet key. Clearing browser storage can hide the symptom, but the durable fix belongs in the shared cache and wallet ownership checks.

Agent checklist:

1. Start `bun dev -v` and wait for web, iOS Metro, and bot runtime readiness.
2. Ask the human to unlock web and iOS as the target account before judging client logs.
3. Use `bun bot traffic label all` after provisioning or renaming bots, then `bun bot traffic fund --target 1000` before transfer traffic if the fleet may be low.
4. Use `mixed` for combined chat/wallet pressure, `chat --solo` or `msg --solo` for single-chat pressure, `chat` or `msg` for chat-list behavior, and `tx` for wallet-list behavior.
5. Prefer `--no-wait` only when deliberately overlapping traffic or leaving a long observation run active.
6. Use `bun bot traffic stop` before changing shape, restarting runtimes, or handing off.
7. Inspect verbose client logs for cache churn, profile/avatar refetches, list-wide rerenders, repeated wallet aggregation, and tx pagination work.

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
