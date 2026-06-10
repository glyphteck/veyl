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
bun dev
bun dev -v
bun dev clear
bun dev bot
bun dev web
bun dev web -v
bun dev web clear
bun dev web mainnet
bun dev web regtest
bun dev ios
bun dev ios -v
bun dev ios clear
bun dev ios mainnet
bun dev ios regtest
bun dev ios tunnel
bun dev ios submit
bun make ios
bun make ios dev
bun make ios test
bun make ios prod
bun make ios store
bun make backend
bun make db
bun make rules
bun make fns
bun make lifecycle
bun map
bun dirty
bun check:paths
bun lint
bun lint:warn
bun lint:fix
bun push
bun merge
bun bot add @mybot
bun bot power @mybot on
bun bot traffic
bun bot traffic mixed @zxrl fast --count 50
bun bot traffic msg @zxrl fast --solo --source @mybot
bun bot traffic tx @zxrl fast --count 300
bun bot traffic fund --amount 1000
bun bot traffic stop
bun bot group @mybot echo on
bun bot sub group:traffic echo
bun bot restart group:echo
bun bot kill @mybot
bun nuke chat
```

## Git Workflows

The old VS Code task workflows are now repo CLI commands. The `.vscode/` folder is intentionally absent; `scripts/repo.mjs` owns these flows.

```bash
bun push
bun merge
```

These commands prompt in the terminal. Use the arrow keys and Enter to choose the version bump. Text prompts collect the commit message and merge PR number when omitted. After the required inputs are collected, the workflow runs quietly and prints the pushed commit id when it succeeds.

Before running either workflow, inspect the staged or intended diff, update [../CHANGELOG.md](../CHANGELOG.md), and choose a concise, specific commit message that reflects the real change. Avoid vague messages like `update` unless the user explicitly requests that exact message.

Changelog entries carry the context that no single commit message can. Broad pushes should group the major product, backend, docs, and tooling changes. Small pushes can use one short bugfix or cleanup bullet, but the bullet still has to say what was fixed or cleaned up.

Keep commit history append-only unless the user explicitly asks for history cleanup. Do not use `git commit --amend`, interactive rebase, squash, reset, or other history-rewrite commands just to keep a change tidy; commit follow-up fixes separately.

The workflows preserve the old task behavior while suppressing routine command output:

- `bun push`: bumps the root package version, stages all changes, commits, and pushes `HEAD` to `main` plus force-updates `regtest`.
- `bun merge`: switches to `main`, fast-forward pulls, checks out the PR with `gh`, merges `FETCH_HEAD` with `--no-ff`, bumps the root package version, stages all changes, commits, and pushes `HEAD` to `main` plus force-updates `regtest`.

Non-interactive forms are also available:

```bash
bun push --version patch --message "document worktree task workflow"
bun merge --pr 123 --version patch --message "merge wallet fee controls"
```

Use `bun push --help` or `bun merge --help` for the script's current usage text.

## Dirty Tree Summary

Use `bun dirty` to print a colorized changed-file summary with total and per-file added and removed line counts. Tracked changes come from `git diff HEAD`; untracked text files count as added lines.

## Agent Map And Path Checks

Use `bun map` before broad repo crawls. It prints the current branch/head, dirty file count, workspace packages, active todo files, feature owner paths, focused docs, and targeted lint commands.

Use `bun check:paths` after moving files, renaming package paths, or touching imports. It catches deleted app workspace layers, old shared package names, removed catch-all files, shadcn scaffolding, and unresolved relative JavaScript imports.

## Worktrees

Use [workflow.md](workflow.md) for when worktrees are appropriate. In short, use the current checkout for small work and reserve linked worktrees for large or collision-prone tasks.

Prefer worktrees outside the repo root:

```bash
mkdir -p ../worktrees
git worktree add -b shortbranch ../worktrees/shortbranch
git worktree list
```

Resume an existing task branch with:

```bash
git worktree add ../worktrees/shortbranch shortbranch
```

Remove completed or abandoned worktrees after confirming the diff is merged, moved, or intentionally discarded:

```bash
git worktree remove ../worktrees/shortbranch
git branch -d shortbranch
```

`bun push` pushes the current `HEAD` to `main` and force-updates `regtest`. It is not a feature-branch publish command. Before using `bun push` or `bun merge`, confirm the current checkout, branch, and intended diff.

## Backend Deploys

When changing Firebase Functions, Firestore rules, Storage rules, indexes, CORS, or backend config scripts, deploy the changed target before handing the work back unless the user explicitly says not to deploy.

Use the narrowest deploy target that matches the change:

```bash
bun make rules
bun make fns
bun make db
bun make cors
bun make lifecycle
```

## Dev Script Notes

- `bun dev` starts web, iOS, and bot together.
- `bun dev`, `bun dev web`, `bun dev ios`, and `bun dev bot` keep routine child output quiet by default. Add `-v` or `--verbose` to show full child output; `bun dev -v` applies that to every child runtime.
- veyl web always uses Turbopack for local dev.
- `bun dev web` clears web `.next` before launch when the cache exceeds 5 GiB. Set `VEYL_WEB_CACHE_MAX_GB` to tune that threshold.
- `bun dev clear` clears web `.next`, iOS `.expo`, and Metro cache before starting the combined runtime.
- `bun dev web clear` clears only the veyl web `.next` cache before starting.
- `bun dev web mem` starts web with V8 heap snapshots near the heap limit; combine with `trace` for Turbopack trace output or `inspect` for Chrome DevTools memory profiling.
- `bun dev ios clear` clears only the veyl iOS `.expo` and Metro caches before starting.
- `bun dev ios` starts Expo in dev-client mode for the installed `dev.veyl` app.
- Validate performance-sensitive iOS startup, unlock, and route-load timings on a standalone test or production build, not only on `bun dev ios`; the dev-client and Metro runtime can bottleneck timing paths that are normal in real builds.
- `bun make ios` and `bun make ios dev` run a clean Expo prebuild, then install the `dev.veyl` Expo dev-client build on `REGTEST` with bundle id `com.glyphteck.veyl.dev`. They do not start Metro; run the dev server separately with `bun dev ios` or the combined runtime.
- `bun make ios reset` uninstalls the dev app before reinstalling it, which clears on-device app data and forces iOS to reprocess the current app identity.
- `bun make ios test` installs the standalone test `test.veyl` build on `REGTEST` with bundle id `com.glyphteck.veyl.test`.
- `bun make ios prod` installs the standalone production `veyl` build on `MAINNET` with bundle id `com.glyphteck.veyl`.
- `bun make ios` is quiet by default: it prints phase lines, writes child command output under `apps/ios/ios/build/<scheme>/logs/<timestamp>/`, logs warning details to `*.warnings.log`, and prints the first failure details plus the full log path when a child command fails. Add `-v` or `--verbose` to also show full child command output.
- `bun dev mainnet` and `bun dev regtest` apply the selected network to web, iOS, and bot.

## Bot Traffic Load Tests

Use the runtime-owned bot action queue for client load testing:

```bash
bun dev -v
bun bot traffic fund --target 1000
bun bot traffic mixed @zxrl fast --count 50
bun bot traffic msg @zxrl fast --solo --source @mybot
bun bot traffic tx @zxrl fast --count 300
bun bot traffic stop
```

`bun bot traffic` defaults to mixed message and transfer traffic targeting `@zxrl`. `mixed`, `msg`, and `tx` accept either `--count N` or `--duration 10m`; duration derives count from the selected delay. `fast` is 500ms between events, `slow` is 5s, and the default delay is 3s. Use `msg --solo` for one bot-owned chat. `tx` always sends 1 sat per transfer. `fund` sends the flat target amount from `@faucet` by default to every enabled traffic-group bot; pass `--source @botname` to use another funding bot. `--amount` is accepted as the same per-bot fund amount.

`bun bot group`, `bun bot behavior`, `bun bot sub`, and `bun bot unsub` update bot `groups` and `behaviors` during a live runtime. The runtime consumes those Firestore changes without a process restart. `bun bot restart <target>` updates `restartAt` for one bot, `all`, `group:name`, or `behavior:name` when a selected session needs a clean reboot.

Run `bun dev -v` while testing so web, iOS, and bot logs show the full receive path. The human has to unlock web and iOS as the target user before observation; web may need to be unlocked again after reloads. Use `mixed` for combined chat/wallet pressure, `msg --solo` for a single chat, `msg` for chat-list behavior, and `tx` for wallet-list behavior.

For parallel pressure, queue no-wait actions:

```bash
bun bot traffic msg @zxrl fast --count 50 --no-wait
bun bot traffic tx @zxrl fast --count 50 --no-wait
```

Use `bun bot traffic stop` before changing the traffic shape, restarting runtimes, or handing work to another agent. Runtime startup also cancels stale queued/running traffic actions.

## iOS Production Builds

`bun make ios prod` prebuilds, builds, and installs the standalone production build on the configured iPhone:

```bash
bun make ios prod
```

The command builds `com.glyphteck.veyl` on `MAINNET` with the Release configuration and does not require the Expo dev server after install. Local iOS make commands use Expo for clean prebuild/config sync, then run `xcodebuild` and install the finished `.app` with `devicectl` because Expo's device-install wrapper hangs on this machine.

Use `bun make ios store` for the cloud EAS App Store build:

```bash
bun make ios store --clear-cache
```

After the App Store Connect app record exists and the EAS build is ready, upload the latest EAS iOS build with:

```bash
bun dev ios submit
```

`bun dev ios submit` runs EAS Submit from `apps/ios` with the prod profile. It defaults to `--latest` and forwards extra EAS Submit flags, so a specific build still works with `bun dev ios submit --id <build-id>`. EAS Submit can use the preset non-secret values in `apps/ios/eas.json`, but the Apple account, App Store Connect app id, or API key still need to come from Apple.

## Local Web Hosts

For local web passkey work, map `domains.veylDev` from [../links.md](../links.md) to `127.0.0.1` in `/etc/hosts` and use:

```txt
links.veylDevWeb
```

`bun dev web` is expected to bind to that host with local HTTPS so the shared `glyphteck.com` RP works without a localhost passkey silo.

Use the chat route directly for web chat checks:

```txt
https://dev.veyl.glyphteck.com:3000/chat
```

The web runner warns when the Next/Turbopack process tree grows past `VEYL_WEB_MEMORY_WARN_MB` MB RSS, defaulting to `3200`. Use `VEYL_WEB_MEMORY_CHECK_MS` to change the polling interval when diagnosing dev-server leaks.

Local root-site work belongs in the separate Website repo.

## Native iOS Dependencies

Use [packages.md](packages.md) for package, Expo SDK, and native dependency rules.

If native iOS dependencies change, the generated native project must be refreshed before judging runtime behavior. The normal local phone path is `bun make ios`, which runs clean Expo prebuild/config sync, builds, installs, and launches the dev client. A manual `pod install` inside `apps/ios/ios` can refresh pods for an already-generated native project, but it is not a replacement for the repo's prebuild/build path after Expo config or package changes.

Do not run a manual app build by default after native package changes. Tell the user what changed and that they need to rebuild.

## Framework Dependency Sync

Detailed package and upgrade rules live in [packages.md](packages.md). In short: web React versions use the root Bun catalog and must still satisfy the installed Next.js peer dependency range. iOS React and React Native versions follow Expo's compatibility table.

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
bun x eslint apps/web/src/lib/example.js
```
