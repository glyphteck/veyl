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

## Language And Patterns

- Default to plain JavaScript. Do not introduce TypeScript unless the user explicitly asks for it.
- Prefer existing patterns over new architecture.
- If web and shared already solve a problem, do not invent a third approach.
- If a change belongs in `shared`, put it there instead of duplicating the same logic in web and iOS.
- For structured data, use structured APIs or parsers instead of ad hoc string manipulation when reasonable.
- Keep lint rules production-oriented. They should catch undefined names, blocked browser prompts, and hook-order mistakes without enforcing broad style churn.
- Do not silence lint unless the exception is narrow and still correct. Remove stale eslint-disable comments when the rule no longer reports.

## Product Language

- In user-facing copy, call other accounts people, users, or friends.
- Reserve `peer` for internal code references only.

## Platform-Sensitive Work

- When touching auth, remember accounts are company-wide and passkeys are rooted at `glyphteck.com`.
- When touching encrypted chat, treat payload shape changes as cross-platform and backend-sensitive.
- When touching wallet code, remember that boot, address derivation, transfer history, and peer analytics are spread across vault, wallet, and tx data providers.
- When touching bots, start with deterministic scripted behavior and normal account primitives.
