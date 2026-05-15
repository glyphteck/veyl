# Bot Guidelines

Use this focused guide when work touches bot accounts, bot runtime behavior, bot admin controls, or bot provisioning. Read the full root [../bots.md](../bots.md) for the complete product and operations model.

## Rules

- Bots are normal veyl accounts with backend runtimes. Keep their data model aligned with regular users unless the root bot doc says otherwise.
- Do not special-case bots in peer, chat, wallet, report, block, or moderation UI unless the behavior is genuinely bot-specific.
- Start bot behavior changes in `apps/veyl/bot/src/runtime.js`, then check shared bot modules under `shared/bot/` and any admin surfaces that expose the state.
- Preserve deterministic scripted behavior before adding broader automation.
- When bot changes touch Firebase Functions, Firestore rules, Storage rules, indexes, or backend config scripts, follow the backend deploy rule in [commands.md](commands.md).

## Entry Points

- Runtime: `apps/veyl/bot/src/runtime.js`
- Entrypoint: `apps/veyl/bot/src/index.js`
- Provisioning: `apps/veyl/bot/src/newbot.js`
- Secrets: `apps/veyl/bot/src/secrets.js`
- Shared modules: `shared/bot/`
- Full doc: [../bots.md](../bots.md)
