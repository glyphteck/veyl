# Vulnerabilities

Last reviewed: 2026-06-10

Scope: attacker-perspective pass over the current repo state, using `guidelines/security.md` as the intended model. This is not a scanner checklist. It prioritizes places where an attacker can learn data, gain metadata, or turn leaked identifiers into control. Server cost and abuse-only issues are listed after the information and destructive-control findings.

## Summary

No direct server-side path was found to recover vault passwords, decrypted master seeds, wallet private material, chat private keys, file keys, or plaintext message bodies. The app's strongest confidentiality boundary is still the local vault plus encrypted chat payload design.

The weakest active areas are:

- Any stolen Firebase auth session can still call account deletion without a fresh server-verifiable passkey/vault proof.
- A leaked chat media path can still drive the unauthenticated media-hold endpoint.
- App Check is advisory until every supported client can provide valid tokens.
- Direct chat writes/media uploads remain cost and junk-traffic surfaces.

The pass also found two concrete app-originated metadata leaks and addressed them in code:

- The `push` callable no longer returns `pingId` or push-route `sent` counts.
- App-owned production console logging is disabled; server function logs now require a verbose local emulator instance, and web/iOS client logs require a verbose dev build.

## P1: Account Deletion Requires Only Firebase Auth At The Server

Evidence:

- Web and iOS deletion flows call `verifyVaultPassword(...)` before showing the final delete action.
- `functions/user/actions/deleteaccount.js` only checks `context.auth.uid` and a uid/day rate limit.

Exploit:

1. Steal or reuse a valid Firebase auth session through XSS, device compromise, token theft, or a malicious authenticated client.
2. Call `deleteAccount` directly.

Impact:

- Deletes the encrypted seed blob, profile, username mapping, passkeys, push records, and user subtree.
- Does not reveal secrets, but can permanently deny access if the user has not exported recovery material.

Fix:

- Do not send the vault password or decrypted seed to the backend.
- Add a fresh passkey reauthentication challenge for deletion, or require a short-lived deletion proof signed by a client-held key only available after vault unlock.
- Keep the current password/vault-decrypt UX, but do not rely on it as the backend authorization boundary.

## P2: Unauthenticated Chat Media Hold Endpoint Is A Bearer-Path Oracle

Evidence:

- `functions/chat/media.js` exposes `setChatMediaHold` as `onRequest({ cors: true })`.
- It accepts only `path` plus `hold`, with no Firebase auth.
- `hold: true` returns `404` when the object is missing; `hold: false` ignores missing objects.
- `guidelines/security.md` says this path-only unauthenticated hold endpoint is intentional for saved chat media.

Exploit:

1. Obtain a leaked `chats/{chatId}/{mediaId}` path.
2. POST to `setChatMediaHold` with `hold: true` or `hold: false`.

Impact:

- Confirms whether a specific media object exists.
- Can force a temporary hold on leaked media, or release one.
- Plaintext media remains encrypted, but retention and availability can be affected.

Fix:

- Return a uniform success response for missing and existing paths to remove the existence oracle.
- Consider a path plus hold-token/MAC design where the token is stored only in the encrypted message payload, so leaked path alone is not enough to change retention.

## P3: App Check Is Not A Security Boundary Yet

Evidence:

- Web initializes App Check with reCAPTCHA Enterprise.
- iOS does not provide App Check tokens.
- `guidelines/security.md` says not to enforce App Check for shared Firebase products or callables until every supported client path can provide valid tokens.

Exploit:

- A custom client can call Firebase APIs and callables directly as long as it can authenticate.

Impact:

- Not a confidentiality break by itself; rules and callable auth remain the real boundary.
- Increases abuse surface for the other findings.

Fix:

- Keep assuming App Check is advisory until iOS support is ready.
- When ready, enforce App Check on shared Firebase surfaces after validating every client path.

## P3: Direct Chat Writes And Media Uploads Are Cost/Abuse Surfaces

Evidence:

- `firestore.rules` allows authenticated direct message creates under any valid, non-deleted 64-hex `chatId`.
- `storage.rules` allows authenticated direct chat media creates under any valid chat media path, capped per object at 64 MiB.
- `todo/server-abuse-prevention.md` explicitly parks the direct Firestore message-send frequency-cap decision.

Exploit:

- Use authenticated accounts to write many encrypted-looking message docs or 64 MiB chat media objects under random chat ids.

Impact:

- Primarily cost, quota, and cleanup pressure.
- With a leaked real `chatId`, also becomes participant-visible junk traffic until clients reject invalid ciphertext/signatures.

Fix:

- Keep this lower priority than the information leaks above.
- If abuse becomes launch-blocking, add a server-issued send lease, low-cost callable send gate, or per-account quota that does not reintroduce plaintext chat metadata.

## Resolved In This Pass

### Push Callable Delivery Metadata

Before this pass, `functions/chat/push.js` returned `sendPush` output to the caller, including the inbox `pingId` and push-route `sent` count. Any authenticated user who knew a target uid could infer whether that target had active push routes and roughly how many.

Current posture:

- `push` still validates sender auth, target uid shape, ping shape, uid/hour rate limit, sender ban state, and recipient block state before writing the sealed inbox ping.
- The callable now returns only `{ success: true }`.
- Push delivery still happens before return, but route counts and ping ids remain server-private.

An inbox-trigger push design was rejected for now because inbox pings are sealed. A trigger would need plaintext sender metadata on the recipient inbox doc, or it would enforce block state after writing a recipient-visible document. A private server queue could work, but that is a larger architecture change and does not improve this boundary over the current callable.

### Production Logs And Client Console Output

Before this pass, Function call wrappers and push delivery code emitted callable names, auth fingerprints, data keys, recipient uids, push counts, and provider errors outside a verbose gate. Client code also had many `console.warn/error` paths that could expose identifiers in production browser/device logs.

Current posture:

- Function wrapper logs now require `VEYL_VERBOSE=1` and `FUNCTIONS_EMULATOR=true`.
- Push delivery result logs were removed.
- Web console output is muted unless `NEXT_PUBLIC_VEYL_VERBOSE=1` in a non-production build.
- iOS console output and persisted diagnostics are muted unless `VEYL_VERBOSE=1` or `EXPO_PUBLIC_VEYL_VERBOSE=1` in a `__DEV__` build.

## Accepted Or Currently Not Exploitable

- No standalone remote path was found that leaks `chatId` to an unrelated user. A stolen `chatId` is still capability material under the current dumb-server chat model, but the realistic app-originated leak path was logging/diagnostics/support capture, not a public query. A compromised participant device is out of scope because it leaks much more than just the `chatId`.
- Authenticated public profile search/list in small batches is an accepted product exposure for client-side user search. Usernames, avatar state, public chat keys, public wallet keys, active flags, and profile ids should not be treated as secrets.
- Email/password auth is disabled; the reviewed auth path is passkey-based.
- Account creation is rate-limited through passkey registration option/verify limits plus the final account-create IP bucket.
- `replaceVault` is currently disabled by `SUPPORTED_MIGRATIONS = new Set([])`, so it is not an active vault-replacement attack path.
- Current web CSP has no script `unsafe-inline` and no `wasm-unsafe-eval`; production script execution is nonce-gated. The remaining `style-src-attr 'unsafe-inline'` is style-only compatibility, not script execution.
- The Firebase client config and web App Check site key are public identifiers, not secrets, assuming API restrictions stay aligned with `guidelines/security.md`.
