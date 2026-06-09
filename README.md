<p align="center">
  <img src="shared/logos/wallet.png" alt="veyl" width="256">
</p>

<h1 align="center"><big>veyl</big></h1>

Veyl lets people own their money and chat privately in one app. It combines a self-custodial Spark Bitcoin wallet with end-to-end encrypted 1:1 messaging, so payments, payment requests, files, and conversations can live in the same private flow instead of being split across apps.

The repo is built around one seed-backed vault. A user signs in with a passkey, creates an encrypted vault, and unlocks local seed material that derives both wallet and chat keys. Glyphteck stores encrypted app data and public profile metadata, but the vault password and wallet/chat secrets stay client-side.

The company website and root-domain trust files live in the separate Website repo. Veyl still depends on `glyphteck.com` for passkeys, app links, and public trust surfaces.

## What Is Here

- `apps/web`: Next.js web client.
- `apps/ios`: Expo / React Native iOS client.
- `apps/bot`: Node bot runtime.
- `shared`: cross-platform product logic imported as `@veyl/shared`.
- `functions`: Firebase Functions package. It is not part of the Bun workspace.
- `guidelines`: focused agent and maintainer docs.
- `todo`: active large-task coordination files only.

Shared domains, product links, local host names, passkey origins, app-link domains, and CORS origins live in `shared/links.js`; the generated reference is [links.md](links.md). Shared logic limits, cache budgets, upload caps, debounce intervals, and polling cadences live in `shared/config.js`.

## Product Shape

The main product loop is simple:

1. Sign in or register with a passkey.
2. Pick a username and create a vault password.
3. Unlock the encrypted local vault.
4. Use the derived wallet key for Bitcoin payments.
5. Use the derived chat key for encrypted 1:1 chat.

Current major surfaces:

- company-wide passkey accounts rooted at `glyphteck.com`
- username and avatar onboarding
- password-encrypted vault seed
- Spark wallet balance, transfers, funding, withdraw, and L1 claim flows
- encrypted 1:1 chat with payment requests, read receipts, reactions, retention, and attachments
- vaulted local cache for fast unlock hydration
- iOS push notifications for new chat messages
- admin, report, moderation, and bot support surfaces

## Start Here

This README is only the human overview. Detailed mechanics live in focused docs:

- Agent rules: [AGENTS.md](AGENTS.md)
- Fast architecture map: [guidelines/map.md](guidelines/map.md) or `bun map`
- Repo shape and product model: [guidelines/repo.md](guidelines/repo.md)
- Workflow, todos, branches, and worktrees: [guidelines/workflow.md](guidelines/workflow.md)
- Commands: [guidelines/commands.md](guidelines/commands.md)
- Validation policy: [guidelines/validation.md](guidelines/validation.md)
- Code and naming rules: [guidelines/code.md](guidelines/code.md)
- Navigation and feature entrypoints: [guidelines/navigation.md](guidelines/navigation.md)
- Chat system: [guidelines/chat.md](guidelines/chat.md)
- Chat lifecycle diagrams: [secrets](lifecycle/secrets.md), [message](lifecycle/msg.md), [chat](lifecycle/chat.md), [batches](lifecycle/batches.md), and [user](lifecycle/user.md)
- Security model: [guidelines/security.md](guidelines/security.md)
- Package and native dependency rules: [guidelines/packages.md](guidelines/packages.md)
- Bot model: [bots.md](bots.md) and [guidelines/bots.md](guidelines/bots.md)
- Legal and App Review context: [legal.md](legal.md), [review.md](review.md), [guidelines/apple-review.md](guidelines/apple-review.md)

Run this before broad repo crawls:

```bash
bun map
```

Use this after file moves, package path changes, or import-heavy refactors:

```bash
bun check:paths
```

## Local Development

Install root workspace packages:

```bash
bun install
```

Install Firebase Functions separately:

```bash
cd functions && npm install
```

Common commands:

```bash
bun dev web
bun dev ios
bun dev bot
bun make ios
bun make ios dev
bun make rules
bun make fns
bun dirty
bun lint
```

Repo push and merge workflows are Bun scripts, not editor tasks:

```bash
bun push
bun merge
```

Before `bun push` or `bun merge`, update [CHANGELOG.md](CHANGELOG.md) with the actual change. The workflow bumps the root version, stages, commits, and pushes the current `HEAD` to `main` and `regtest`.

## Configuration

Important public environment inputs:

- `NEXT_PUBLIC_NETWORK`: web wallet network, usually `MAINNET` or `REGTEST`
- `NEXT_PUBLIC_VEYL_VARIANT`: web branding variant, `dev`, `test`, or `prod`
- `EXPO_PUBLIC_EAS_PROJECT_ID` / `EXPO_PROJECT_ID`: optional iOS EAS project override

Veyl has separate dev, test, and prod artwork under `shared/logos`. Firebase client config is shared in `shared/firebaseconfig.js`.

## Validation

Lint is the default verification during agent work:

```bash
bun --filter @glyphteck/veyl-web lint
bun --filter @glyphteck/veyl-ios lint
bun --filter @glyphteck/veyl-bot lint
bun --filter @veyl/shared lint
cd functions && npm run lint
```

Do not run builds, typechecks, tests, formatters, or broad verification commands unless the task asks for them. Backend deployable surfaces are complete only after deploying the changed target.

## Planning

Active large-task plans live in `todo/`. Completed work belongs in durable docs or [CHANGELOG.md](CHANGELOG.md), not in todo files.

Use Git for the actual diff:

```bash
git status --short
bun dirty
git diff -- path/to/file
```

Use a todo file for coordination and handoff context. Use a short branch plus linked worktree only when parallel implementation or many-file overlap makes the main checkout risky.
