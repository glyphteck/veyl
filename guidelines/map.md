# Agent Map

Use this as the fast orientation map after `AGENTS.md` and `README.md`. It is intentionally shorter than the product docs. Read the focused guideline file only after this map tells you which system owns the task.

For a live version with branch, dirty files, workspace package names, active todos, feature starts, and lint commands, run:

```bash
bun map
```

## Repo Shape

- `apps/web`: Next.js Veyl client.
- `apps/ios`: Expo / React Native Veyl client.
- `apps/bot`: Node bot runtime.
- `shared`: cross-platform package imported as `@veyl/shared`.
- `functions`: Firebase Functions package. It is not in the Bun workspace.
- `scripts`: repo, dev, build, admin, map, and sanity tooling.
- `todo`: active large-task coordination only. Completed work does not live there.

## First Files By System

| System | Start Here | Related Owners | Focused Docs |
| --- | --- | --- | --- |
| auth/passkeys | `apps/web/src/lib/passkey.js`, `apps/ios/src/lib/passkeys.js`, `functions/passkey/*` | `shared/passkey.js`, `shared/passkeylabel.js`, `apps/web/src/lib/routeguards.js` | `guidelines/navigation.md`, `guidelines/security.md` |
| vault/cache | `shared/vault.js`, `shared/cache/localdata.js` | `apps/web/src/lib/cache/*`, `apps/ios/src/lib/cache/*` | `guidelines/navigation.md`, `guidelines/security.md` |
| chat | `shared/providers/chatprovider.js`, `shared/chat/*`, `shared/chat/messages/batches/*` | `apps/web/src/components/chat/*`, `apps/ios/src/components/chat/*`, `apps/bot/src/runtime.js` | `guidelines/chat.md`, `lifecycle/`, `guidelines/security.md`, `bots.md` |
| chat media | `shared/chat/attachments.js`, `shared/chat/filepayload.js` | `apps/web/src/lib/chat/*cache.js`, `apps/ios/src/lib/chat/media.js`, `apps/ios/src/lib/chat/imagecache.js` | `lifecycle/msg.md`, `guidelines/chat.md`, `guidelines/uistyling.md` |
| wallet | `shared/wallet/provider.js`, `shared/wallet/*` | `apps/web/src/components/providers/walletprovider.js`, `apps/ios/src/providers/walletprovider.js` | `guidelines/navigation.md`, `guidelines/security.md` |
| navigation/resume | `apps/web/src/lib/routeguards.js`, `shared/navigation/resume.js` | `apps/web/src/app/rootredirect.js`, `apps/ios/src/lib/navigation/*` | `guidelines/navigation.md` |
| user/profile/search | `shared/profile.js`, `shared/avatar.js`, `shared/search/*` | `apps/web/src/lib/user/*`, `apps/ios/src/lib/user/*`, app search wrappers | `guidelines/navigation.md`, `guidelines/code.md` |
| admin/bots | `apps/bot/src/runtime.js`, `shared/bot/*`, `scripts/admin/bot.mjs` | `apps/web/src/components/providers/adminprovider.js`, `functions/admin/*`, `functions/lib/bots.js` | `guidelines/bots.md`, `bots.md` |
| legal/review | `shared/legal.js`, `legal.md`, `review.md` | `apps/web/src/app/legal/page.js`, `apps/ios/app/(vault)/(app)/legal.js` | `guidelines/apple-review.md` |
| repo tooling | `scripts/*.mjs`, `package.json`, `guidelines/commands.md` | `AGENTS.md`, `guidelines/workflow.md`, `guidelines/validation.md` | `guidelines/workflow.md`, `guidelines/commands.md` |

## Generic Helpers

- Text, time, number, array, display, image, filename, filetype, async, and diagnostics primitives live under `shared/utils/*`.
- Route/search param normalization lives under `shared/navigation/*`.
- Money helpers live in `shared/money.js`.
- Avatar/profile helpers live in `shared/avatar.js` and `shared/profile.js`.
- Chat ids, equality, message keys, preview envelopes, and storage-file keys live under `shared/chat/*`.
- Wallet tx and balance helpers live under `shared/wallet/*`.

Do not recreate old catch-all files such as `shared/utils.js`, `shared/localdatacache.js`, `shared/vaultutils.js`, flat app-level chat media helpers, or shadcn `components.json` / `components/ui` scaffolding.

## Fast Commands

```bash
bun map
bun dirty
bun check:paths
bun --filter @glyphteck/veyl-web lint
bun --filter @glyphteck/veyl-ios lint
bun --filter @glyphteck/veyl-bot lint
bun --filter @veyl/shared lint
cd functions && npm run lint
```

Use `bun check:paths` after moving files, renaming package paths, or touching imports. It catches old architecture references and unresolved relative imports that lint may miss.

## Work Tracking

- The actual diff is tracked by Git. Use `git status --short`, `git diff`, and `bun dirty`.
- A `todo/` file tracks intent, ownership, branch/worktree, collision notes, and handoff state for large or collision-prone work. It does not isolate files or replace Git.
- A branch plus linked worktree isolates parallel implementation. Use it when many files, long-running work, or likely overlap would make one checkout risky.
- Small narrow fixes should stay in the current checkout without a todo file or worktree.
- If a worktree is used, keep the task file in the primary checkout's `todo/` so other agents can see the coordination record.

## Validation Posture

Lint is the default verification. Do not run builds, typechecks, tests, formatters, or broad verification commands unless the user asks. Backend deployable surfaces are complete only after deploying the changed target.
