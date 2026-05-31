# Validation

## Default Policy

- Linting is allowed. Prefer targeted lint runs for files or packages you touched.
- Use lint to catch mechanical issues instead of rereading every touched file by hand.
- Do not run `git diff --check`, tests, builds, typechecks, formatters, or any other non-lint verification commands unless the user explicitly asks.
- Do not assume there is a required TypeScript typecheck step.
- If the user asks for broader validation, prefer the narrowest command that matches the task before repo-wide checks.
- If you add or remove a native package, do not run a manual app build by default. Tell the user they need to rebuild, and list the packages changed in the conclusion.
- Backend deployable surfaces are not complete until deployed. If you change Firebase Functions, Firestore rules, Storage rules, indexes, or backend config scripts, deploy the changed target before handing work back unless the user explicitly says not to deploy.

## Lint Commands

From the repo root:

```bash
bun lint
bun lint:warn
bun lint:fix
```

`bun lint` is error-only and low-noise. The repo should keep both `bun lint` and `bun lint:warn` clean.

Lint is intentionally not a formatter or style gate. It should speed up work by catching mechanical issues:

- undefined names
- blocked browser prompts
- React hook-order mistakes
- stale eslint-disable comments

Target a package when the change is local:

```bash
bun --filter @glyphteck/veyl-web lint
bun --filter @glyphteck/veyl-ios lint
bun --filter @glyphteck/veyl-bot lint
bun --filter @veyl/shared lint
cd functions && npm run lint
```

## Repo Shape Sanity

When a task moves files, renames package paths, or changes many imports, run:

```bash
bun check:paths
```

This is a cheap architecture guard, not a formatter or typecheck. It catches deleted paths and unresolved relative imports that lint may not resolve.

Target specific files when that is enough:

```bash
bun x eslint path/to/file.js
```

## Files To Avoid Editing

Do not make hand edits in generated or vendor directories unless the task is explicitly about them:

- `node_modules/`
- `apps/web/.next/`
- `apps/ios/.expo/`
- `apps/ios/ios/Pods/`
- `apps/ios/ios/build/`
