# Callable Rate Limits

status: active
branch: current
worktree: current

## Scope

Add a cheap abuse-control layer for public or high-volume Firebase callables without changing the auth flow.

Primary targets:

- `passkeyRegisterOptions` and `passkeyLoginOptions`, which are unauthenticated and write `passkey_challenges`.
- `submitReport`, which can create report records and optional Storage evidence references.
- Any other callable that can produce repeated backend writes or third-party calls from untrusted client input.

## Constraints

- Keep passkey signup/login UX unchanged for normal users.
- Prefer App Check, simple per-IP/per-origin throttling, or low-cost Firestore counters only if the write cost stays lower than the abuse it prevents.
- Do not add captchas, legacy fallbacks, or broad middleware unless the final design proves they are necessary.

## Plan

- Confirm whether Firebase App Check is viable for web and iOS in the current deployment model.
- Decide which callables should require App Check versus per-uid or per-origin throttling.
- Add one shared rate-limit helper only if multiple callables need the same enforcement.
- Make rejected requests fail with explicit `resource-exhausted` or `permission-denied` errors.
- Deploy changed Functions and document the enforcement model in `guidelines/security.md` or `README.md` when shipped.
