# Bot Guidelines

Use this focused guide when work touches bot accounts, bot runtime behavior, bot admin controls, or bot provisioning. Read the full root [../bots.md](../bots.md) for the complete product and operations model.

## Rules

- Bots are normal veyl accounts with backend runtimes. Keep their data model aligned with regular users unless the root bot doc says otherwise.
- Keep the bot runtime current with client chat architecture changes. When message lifecycle, retention, control payloads, media handling, or send/read semantics change in the clients, update `apps/bot/src/runtime.js` in the same task instead of letting the runtime lag behind.
- Do not special-case bots in peer, chat, wallet, report, block, or moderation UI unless the behavior is genuinely bot-specific.
- Start bot behavior changes in `apps/bot/src/runtime.js`, then check shared bot modules under `shared/bot/` and any admin surfaces that expose the state.
- Preserve deterministic scripted behavior before adding broader automation.
- When bot changes touch Firebase Functions, Firestore rules, Storage rules, indexes, or backend config scripts, follow the backend deploy rule in [commands.md](commands.md).
- For client load testing, use the runtime-owned `bun bot traffic` subcommands from the root bot doc. Do not write a separate sender process; queue actions into the live runtime so existing bot sessions, wallet state, cancellation, and logging stay in one place.
- If traffic transfer testing makes a client show transfers that the unlocked wallet does not own, inspect shared wallet/cache ownership gates before blaming Spark or the sender bots. Transfer cache reads and writes must be scoped by wallet public key and reject rows where neither side matches that key.

## Traffic Load-Test Workflow

Use the traffic workflow to stress client receive paths. Keep it runtime-owned: do not create separate sender scripts or one-off loops that bypass the bot runtime sessions.

1. Start verbose runtimes:

```bash
bun dev -v
```

2. Ask the human to open and unlock web and iOS as the target user, usually `@zxrl`.

3. Label and fund the traffic fleet before transfer tests:

```bash
bun bot traffic label all
bun bot traffic fund --target 1000
```

`traffic label all` applies canonical defaults: ordinary bots become traffic+echo bots, `@faucet` stays the funding bot, `@echo` stays echo-only, and `@review` stays review+echo. `traffic fund` sends the flat target amount from `@faucet` by default to each enabled traffic-role bot. It is not a balance top-up calculation. Use `--source @botname` for another funding source and `--amount` as an alias for the per-bot amount.

4. Run mixed and message traffic while the chat list is visible:

```bash
bun bot traffic
bun bot traffic mixed @zxrl fast --count 50
bun bot traffic msg @zxrl slow --duration 10m --no-wait
bun bot traffic msg @zxrl fast --solo --source @mybot
```

5. Run transfer traffic while the wallet transfer list is visible:

```bash
bun bot traffic tx @zxrl fast --count 300 --no-wait
```

`fast` means 500ms between events, `slow` means 5s, and the default delay is 3s. Transfer traffic always sends 1 sat per transfer. Message traffic covers each active traffic bot once before repeating, and randomly chooses text or payment-request content using the shared weights in `shared/bot/traffic/messages.js`; transfer constants live in `shared/bot/traffic/transfers.js`. `msg --solo` pins every message to one bot-owned chat.

6. Stop before changing traffic shape, restarting runtimes, or handing off:

```bash
bun bot traffic stop
```

Traffic actions are queued under the runtime action collection and the runtime records requested count, sent count, sender distribution, transfer ids when available, failures, and cancellation state. Use verbose web/iOS logs to decide whether the client is doing unnecessary cache writes, profile/avatar fetches, list-wide rerenders, or wallet history reconciliation work.

## Entry Points

- Runtime: `apps/bot/src/runtime.js`
- Entrypoint: `apps/bot/src/index.js`
- Provisioning: `apps/bot/src/newbot.js`
- Secrets: `apps/bot/src/secrets.js`
- Shared modules: `shared/bot/`
- Traffic config and pools: `shared/bot/traffic/traffic.js`, `shared/bot/traffic/messages.js`, `shared/bot/traffic/transfers.js`
- Role config: `shared/bot/roles.js`
- CLI: `scripts/admin/bot.mjs`
- Full doc: [../bots.md](../bots.md)
