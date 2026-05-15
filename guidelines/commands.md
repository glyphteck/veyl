# Commands

Run workspace installs from the repo root:

```bash
bun install
```

Functions install separately:

```bash
cd functions && npm install
```

## Common App Commands

```bash
bun veyl
bun veyl clear
bun veyl bot
bun veyl web
bun veyl web clear
bun veyl web mainnet
bun veyl web regtest
bun veyl ios
bun veyl ios local
bun veyl ios clear
bun veyl ios mainnet
bun veyl ios regtest
bun veyl ios tunnel
bun make ios
bun make ios local
bun make backend
bun make db
bun make rules
bun make fns
bun lint
bun lint:warn
bun lint:fix
bun push
bun merge
bun bot add @mybot
bun bot power @mybot on
bun bot kill @mybot
```

## Git Workflows

The old VS Code task workflows are now repo CLI commands. The `.vscode/` folder is intentionally absent; `scripts/repo.mjs` owns these flows.

```bash
bun push
bun merge
```

Both commands prompt in the terminal. Use the arrow keys and Enter to choose the version bump. Text prompts collect the commit message and merge PR number when omitted. After the required inputs are collected, the workflow runs quietly and prints the pushed commit id when it succeeds.

Before running either workflow, inspect the staged or intended diff and choose a concise, specific commit message that reflects the real change. Avoid vague messages like `update` unless the user explicitly requests that exact message.

The workflows preserve the old task behavior while suppressing routine command output:

- `bun push`: bumps the root package version, stages all changes, commits, and pushes `HEAD` to `main` plus force-updates `regtest`.
- `bun merge`: switches to `main`, fast-forward pulls, checks out the PR with `gh`, merges `FETCH_HEAD` with `--no-ff`, bumps the root package version, stages all changes, commits, and pushes `HEAD` to `main` plus force-updates `regtest`.

Non-interactive forms are also available:

```bash
bun push --version patch --message "update"
bun merge --pr 123 --version patch --message "update"
```

Use `bun push --help` or `bun merge --help` for the script's current usage text.

## Backend Deploys

When changing Firebase Functions, Firestore rules, Storage rules, indexes, CORS, or backend config scripts, deploy the changed target before handing the work back unless the user explicitly says not to deploy.

Use the narrowest deploy target that matches the change:

```bash
bun make rules
bun make fns
bun make db
bun make cors
```

## veyl Script Notes

- `bun veyl` starts web, iOS, and bot together.
- veyl web always uses Turbopack for local dev.
- `bun veyl clear` clears web `.next`, iOS `.expo`, and Metro cache before starting the combined runtime.
- `bun veyl web clear` clears only the veyl web `.next` cache before starting.
- `bun veyl ios clear` clears only the veyl iOS `.expo` and Metro caches before starting.
- `bun veyl ios local` installs/runs the standalone `veyl local` iOS build on `REGTEST` with bundle id `com.glyphteck.veyl.local`.
- `bun veyl mainnet` and `bun veyl regtest` apply the selected network to web, iOS, and bot.

## Local Web Hosts

For local web passkey work, map `domains.veylDev` from [../links.md](../links.md) to `127.0.0.1` in `/etc/hosts` and use:

```txt
links.veylDevWeb
```

`bun veyl web` is expected to bind to that host with local HTTPS so the shared `glyphteck.com` RP works without a localhost passkey silo.

Local root-site work belongs in the separate Website repo.

## Native iOS Dependencies

If native iOS dependencies change:

```bash
cd apps/veyl/ios/ios && pod install
```

Do not run a manual app build by default after native package changes. Tell the user what changed and that they need to rebuild.

## Framework Dependency Sync

Web React versions use the root Bun catalog and must still satisfy the installed Next.js peer dependency range. iOS React and React Native versions follow Expo's compatibility table.

After bumping `next` or `expo`, run:

```bash
bun install
bun sync:frameworks
bun install
```

`bun sync:frameworks` keeps web app React dependencies on the root Bun catalog, checks that catalog against the installed Next.js `react` / `react-dom` peer ranges, and runs `expo install --fix` for the iOS app's React Native compatibility set. Do not manually bump `react`, `react-dom`, `react-native`, Reanimated, Worklets, Screens, SVG, or other listed Expo-managed native package versions unless the task is specifically to override Expo's compatibility table. Native library major bumps, such as camera packages, must include the matching code migration instead of being pinned back to an older API.

For a non-mutating check:

```bash
bun check:frameworks
```

## Lint

Linting is intentionally lightweight and allowed during agent work.

Use the root command for repo-wide checks:

```bash
bun lint
```

`bun lint` is error-only. Use `bun lint:warn` when advisory warnings are useful.

Use package filters or direct file linting for faster local checks:

```bash
bun --filter @glyphteck/veyl-web lint
bun x eslint apps/veyl/web/src/lib/example.js
```
