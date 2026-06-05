# Code Guidelines

## Naming

- Prefer short, plain names for variables, functions, objects, files, and providers.
- Use simple verbs for actions: `play`, `pause`, `seek`, `send`, `save`, `open`, `close`.
- Avoid complex words, abstract nouns, and multiword names when a shorter name is clear in local context.
- Do not name a thing after implementation scaffolding when a product/domain name is simpler. For example, use `audioprovider` for app-wide media playback instead of `playbackprovider` unless there are multiple concrete providers.
- Keep object keys short when the shape is local and obvious. Prefer `{ kind, key }` over longer labels unless the extra words prevent real ambiguity.
- Generic UI belongs at the closest generic component level. If a control is not message-specific, do not keep it under `messages/`.
- Keep file names lowercase.
- Short does not mean vague. Tiny names like `x`, `data`, `item`, and `value` are fine for very local transforms, but exported APIs and cross-file shapes need enough domain signal to read safely.
- Avoid scaffolding words like `manager`, `controller`, `coordinator`, `processor`, and `handler` unless the code really owns that broad role.
- Prefer product nouns over technical plumbing nouns. Use names like `chat`, `wallet`, `audio`, `vault`, `seed`, `profile`, and `bot` when those are the actual concepts.
- `handle*` names are fine for UI event callbacks. For reusable logic, prefer the verb itself.
- Branch names follow the same naming bar: no agent prefixes or namespace prefixes like `codex/`, `codex-`, or similar. Use the shortest meaningful lowercase name, preferably one word.

## Structure

- Less is more. When fixing a bug or changing a feature, question the existing code before adding onto it.
- Prefer removing, collapsing, or replacing code over layering more logic on top of a messy path.
- Even when enhancing a feature, a smaller reimplementation is often better than preserving a bloated old approach.
- Favor less code when possible. It is easier to review, understand, and change.
- Before launch, prefer clean cutovers over backward-compatible shims, aliases, wrappers, or duplicate export paths.
- When refactoring structure, update imports across the repo and delete the old path instead of leaving compatibility code behind.
- Keep React hooks before any early return. Derive booleans first, define hooks and callbacks, then return `null` or fallback UI.
- Prefer small top-level helpers for pure transforms. Keep component bodies focused on state, hooks, and rendering.
- Provider wrappers should stay thin. Put shared behavior in `shared` and keep app providers mostly responsible for platform wiring.
- Avoid one-function files unless the function is reused across an ownership boundary, is a public module boundary, or names an important sub-concept inside a large system. Otherwise keep the helper near its caller.
- Do not recreate deleted catch-all modules such as root `shared/utils.js`, `shared/localdatacache.js`, or flat app-level chat media helpers. Use the current feature folders.
- Do not add shadcn-generated scaffolding back to the web app. Veyl-owned UI primitives live under `apps/web/src/components`.

## Language And Patterns

- Default to plain JavaScript. Do not introduce TypeScript unless the user explicitly asks for it.
- Prefer existing patterns over new architecture.
- If web and shared already solve a problem, do not invent a third approach.
- If a change belongs in `shared`, put it there instead of duplicating the same logic in web and iOS.

## Shared Helper Boundaries

- Put arbitrary shared logic knobs in `shared/config.js`: batch sizes, fetch caps, cache budgets, upload limits, debounce intervals, retention durations, polling cadences, and profile/search limits. Keep protocol constants, schema versions, and UI styling/animation values next to their owners unless a dedicated config pass moves them.
- Use `MONEY_UNITS`, `moneyUnitLabel`, money conversion, and money render helpers from `shared/money.js` instead of repeating `sats`/`btc`/`usd` arrays or conversion logic.
- Use `shared/utils/time.js` for timestamp-like values, date/hour keys, and time/date display labels; use `shared/utils/async.js` for simple delay, UI-yield, or idle promises; use `shared/utils/text.js` for plain string trimming/lowercasing instead of creating local `toMillis`, `timestampMs`, `sleep`, `yieldToUi`, `waitForIdle`, `cleanText`, or trim-plus-lowercase helpers.
- Use `shared/utils/number.js` for cross-module numeric cleaners and config parsing. Keep obvious one-off UI clamps local when an import would make the code harder to follow.
- Use `shared/utils/array.js` for repeated truthy unique lists, sets, sorted unique lists, and simple array equality. Keep simple local `new Set(...)` usage local when it only serves one component.
- Use `shared/chat/equal.js` for chat Firestore `Bytes` and message-head equality used by listener caches.
- Use `shared/chat/ids.js` for peer chat key extraction from owner chat entries. Do not inspect or recreate legacy `participants` arrays.
- Use `shared/chat/messagekeys.js` for message id/cid key sets instead of re-creating local key arrays in chat UI.
- Use `storedFileKey` from `shared/chat/messages` for stored chat media cache keys instead of hand-building `peer:path:key` strings.
- Chat previews belong in encrypted owner chat entries, not parent chat `preview` documents.
- Use `shared/utils/display.js` for address/label truncation, byte-size labels, emoji-only text sizing, and safe DOM/SVG id parts.
- Keep web `src/lib/classes.js` limited to styling class composition such as `cn`; import generic helpers from `@veyl/shared/utils/*` and domain helpers from their feature folders.
- Use `shared/avatar.js` for avatar version parsing, source keys, versioned avatar URLs, remembered-avatar metadata, remembered-avatar sorting, and remembered-avatar username cleanup.
- Use `shared/moderation.js` for ban expiry and active-ban checks instead of duplicating moderation timestamp parsing in providers or admin UI.
- Use `shared/report.js` for report attachment names, MIME fallbacks, and report field shaping.
- Use `shared/utils/diagnostics.js` for optional diagnostic callbacks instead of local `markDiag`, `markDone`, or `markError` clones.
- Use `shared/utils/filename.js` for plain filename sanitizing/random capture names and `shared/utils/filetype.js` for filename/MIME sniffing; keep them separate from chat upload modules so lightweight media utilities do not import encryption/upload code. Use iOS `src/lib/file.js` for React Native local `file://` URI normalization and idempotent directory creation.
- Use `shared/utils/image.js` for byte-level image MIME/extension sniffing instead of keeping image-byte primitives at the shared root.
- Use `shared/navigation/params.js` for route/search param values that may arrive as either arrays or scalars.
- Use `shared/profile.js` for profile-shape normalization, profile display labels, peer-key predicates, and peer uid/key extraction.
- Use `shared/navigation/resume.js` for cross-platform route-resume helpers; keep platform navigation-state plumbing local.
- Use `shared/qr.js` for QR payload creation/parsing and `shared/vault.js` for cross-platform vault boot/lock primitives.
- Use web `src/lib/cache/idb.js` for IndexedDB request, transaction, object-store creation, and retryable opener helpers.
- Use web `src/lib/admin/format.js` for admin-only user labels, bot status classes, sat balances, and admin timestamps.
- Use web `src/components/peergrid.js` for the shared new-chat/share peer grid cell, height, and incremental-loading hook.
- Use iOS `src/lib/navigation/routelock.js` for temporary route-navigation locks instead of repeating route lock refs and timers in screens.
- Use `shared/wallet/tx.js` for wallet transfer timestamp parsing and transfer status checks instead of local `createdTime` or status coercers.
- Use `shared/wallet/balance.js` for wallet balance coercion and positive-balance checks instead of local `Number(balance)`/`BigInt(Math.floor(...))` snippets.
- Use `shared/passkey.js` for passkey error normalization and error-code predicates, and `shared/passkeylabel.js` for generated passkey labels; keep WebAuthn byte conversion and native passkey prompt wiring in the platform modules.
- Use `shared/username.js` for app, bot, and admin username normalization/validation. Keep `functions/lib/regex.js` functions-local unless the Firebase deploy layout is changed.

## Implementation Hygiene

- For structured data, use structured APIs or parsers instead of ad hoc string manipulation when reasonable.
- Keep lint rules production-oriented. They should catch undefined names, blocked browser prompts, and hook-order mistakes without enforcing broad style churn.
- Do not silence lint unless the exception is narrow and still correct. Remove stale eslint-disable comments when the rule no longer reports.

## Multi-Agent Hygiene

Use [workflow.md](workflow.md) for the detailed task-file, branch, worktree, handoff, and cleanup policy.

- Assume unrelated file changes may belong to another active agent. Do not revert, restyle, or opportunistically refactor them.
- Keep your diff scoped and easy to identify. Prefer task-specific file names, todo plan names, commit messages, and PR text over broad labels.
- When parallel work is unrelated, proceed without coordinating through code changes.
- If a large overhaul or many-file change has an obvious collision risk, use a separate short task-specific branch and linked worktree, then record both in the task file. Branch names still must not include agent prefixes.
- Before handing work back, remove temporary labels, scratch files, planning artifacts, or coordination-only scaffolding you created when they are no longer useful. Do not remove active todo context or durable documentation.

## Product Language

- In user-facing copy, call other accounts people, users, or friends. Keep app language casual and familiar.
- `peer` and `peers` are internal naming for code, providers, and data. Never show those words in visible labels, empty states, buttons, alerts, placeholders, review/legal copy, or toasts.

## Platform-Sensitive Work

- When touching auth, remember accounts are company-wide and passkeys are rooted at `glyphteck.com`.
- When touching encrypted chat, treat payload shape changes as cross-platform and backend-sensitive.
- When touching chat lifecycle, keep the shared module as the source of truth for retention, read visibility, saved-message TTL, hidden checkpoints, hard source-doc deletion, and action-log rendering. Do not duplicate those calculations in web and iOS message lists.
- Chat/account deletion UI must use shared provider flows, not direct callable invocations, so message deletes can pass saved/media keys and whole-chat deletes can remove the chat media prefix consistently.
- When touching wallet code, remember that boot, address derivation, transfer history, and peer analytics are spread across vault, wallet, and tx data providers.
- When touching bots, start with deterministic scripted behavior and normal account primitives.
- Bot action contracts belong in `shared/bot/*`; admin scripts and runtimes should consume the same validators instead of carrying parallel rules.
