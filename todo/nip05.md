# NIP-05 Identity Base

status: active
branch: current
worktree: current
base: main@7a56ce638bfa
repo version: 0.14.0

## Scope

Add the base infrastructure for Veyl-owned NIP-05 identifiers in the form `username@glyphteck.com`.

This task should create and publish a deterministic Nostr public key for each Veyl account after the vault is first unlocked, using the same first-unlock pattern as wallet and chat key publication. It should not add a visible Nostr UI, public posting, relay sync, zaps, Nostr Wallet Connect, import/export controls, or any fallback identity path.

## Spec Notes

- NIP-01 says Nostr accounts are secp256k1 Schnorr keypairs, and event `pubkey` values are 32-byte lowercase hex public keys.
- NIP-05 identifiers live in a kind `0` metadata event under the `nip05` field, then clients fetch `https://<domain>/.well-known/nostr.json?name=<local-part>`.
- The NIP-05 response must be JSON shaped as `{ "names": { "<name>": "<lowercase hex pubkey>" } }`.
- The optional but recommended `relays` field maps pubkeys to relay URL arrays. Include it only when Veyl has an intentional default relay policy.
- NIP-05 local-parts may use `a-z0-9-_.`; Veyl usernames are stricter (`a-z0-9`), so unsupported local-parts should resolve to an empty `names` object.
- The endpoint must not redirect, and should include `Access-Control-Allow-Origin: *` so browser Nostr clients can validate it.
- NIP-05 identifies a pubkey; clients should still follow/store pubkeys, not the DNS name.

Primary docs:

- https://github.com/nostr-protocol/nips/blob/master/01.md
- https://github.com/nostr-protocol/nips/blob/master/05.md
- https://github.com/nostr-protocol/nips/blob/master/24.md

## Source Of Truth

- `profiles/{uid}.nostrPK`: the Veyl-owned Nostr public key for that account.
- `usernames/{username}.uid`: the username-to-account mapping.
- `profiles/{uid}.username`: the profile display username already used throughout Veyl.

Do not create a separate durable NIP-05 mapping collection unless public resolver cost proves the two-read source-of-truth path is too expensive. If a cache is added later, it must be derived, short-lived, and clearly owned by the resolver layer.

## Write Boundary

Veyl repo:

- `shared/nostr/*`: Nostr key/public-key helpers and validation.
- `shared/vault.js`: first-unlock `bootNostr` flow beside `bootWallet` and `bootChat`.
- `apps/web/src/components/providers/vaultprovider.js`: derive and zero the Nostr seed during unlock.
- `apps/ios/src/providers/vaultprovider.js`: derive and zero the Nostr seed during unlock.
- `apps/web/src/lib/vault.js` and `apps/ios/src/lib/vault.js`: platform wiring for `bootNostr`.
- `shared/providers/userprovider.js`, `shared/profile.js`, `shared/peers.js`: surface `nostrPK` only as inert profile data.
- `functions/user/onboarding/*`, `functions/index.js`: callable that stores `nostrPK` server-side.
- `functions/lib/regex.js` or a new functions-local Nostr helper: validate lowercase 64-char hex pubkeys.
- `functions/nostr/*`: public resolver endpoint or helper used by the Website root-domain route.
- `firestore.rules` only if the implementation changes client-visible profile write rules; the preferred path keeps profile writes server-side.
- Focused durable docs after implementation, likely `guidelines/security.md`, `guidelines/repo.md`, and this file removal/trim.

Website repo:

- `/Users/zaksorel/glyphteck/website/src/app/.well-known/nostr.json/route.js`: root-domain NIP-05 route handler.
- `/Users/zaksorel/glyphteck/website/next.config.js`: headers only if the route handler cannot set everything directly.
- Website docs only if the root-domain trust-file behavior needs durable mention.

## Plan

1. Add Nostr key helpers in `shared/nostr`.
   - Derive a deterministic private key from `deriveSeed(masterSeed, 'nostr')`.
   - Use secp256k1 Schnorr/x-only public keys, not the existing X25519 chat key path.
   - Return lowercase hex public keys and zero private/seed bytes after use.
   - Keep this owner separate from `shared/chat` because Nostr identity is not Veyl encrypted chat.

2. Add a server-owned `setNostrPK` callable.
   - Require auth and the existing callable rate limiter style.
   - Validate a 64-char lowercase hex public key.
   - If the profile has no `nostrPK`, reject duplicates and store it on `profiles/{uid}`.
   - If the profile already has the same `nostrPK`, no-op.
   - If the profile already has a different `nostrPK`, reject. Import/external-signer support is a separate future key-source feature, not a fallback here.

3. Tighten username permanence before publishing public DNS identity.
   - The product does not expose username changes after onboarding today, but `functions/user/onboarding/setusername.js` should still explicitly reject a second different username at the callable/API layer before NIP-05 depends on usernames as public handles.
   - If username changes are ever supported later, they need one deliberate callable that atomically moves the username doc and lets the old NIP-05 handle go invalid.

4. Add first-unlock publication.
   - Web and iOS should derive `nostrSeed` in the existing unlock derivation phase beside wallet, chat, and cache keys.
   - `shared/vault.js#bootNostr` should publish `nostrPK` through `setNostrPK` only when `user.nostrPK` is missing.
   - Subsequent unlocks should only compare the derived key to `user.nostrPK` and fail on mismatch.
   - Do not fetch relays, publish kind `0` metadata, or do any Nostr network sync during unlock.

5. Add a Veyl-owned resolver surface.
   - The resolver receives `name`, normalizes it with the same username rules, reads `usernames/{name}.uid`, reads that profile, and returns the profile `nostrPK` only when the profile username still matches.
   - Missing, invalid, or not-yet-unlocked names should return `200` with `{ "names": {} }`.
   - Include `relays` only after choosing intentional default relays.
   - Use conservative cache headers so repeated lookups do not hammer Firestore, but avoid long stale windows after account deletion or future username movement.

6. Expose the root-domain well-known route from the Website repo.
   - Implement a direct JSON route for `/.well-known/nostr.json`, not a redirect to a Firebase Function.
   - The route should call the Veyl resolver server-side and return the final JSON itself.
   - It must set `Content-Type: application/json`, `Access-Control-Allow-Origin: *`, and a cache policy.
   - Keep Firebase/Admin credentials out of the Website repo; use a public resolver URL or deployment-managed server env only.

7. Validate narrowly.
   - Veyl: targeted lint for touched shared/functions files; deploy Functions with `bun make fns` if backend functions changed.
   - Website: targeted lint for the route handler.
   - Manual HTTP checks:
     - `curl -i 'https://glyphteck.com/.well-known/nostr.json?name=<username>'`
     - verify status is not a redirect, CORS is present, content type is JSON, and the pubkey is lowercase hex.
   - Regtest can validate derivation and local/staging endpoint behavior, but public Nostr client validation needs a publicly reachable HTTPS domain. Regtest wallet network does not matter for NIP-05.

## Collision Notes

The current Veyl checkout has unrelated dirty iOS chat, peer-picker, send-photo, and share-media files outside this task's scope. Keep NIP-05 implementation isolated from that work, and re-check the Website checkout before editing root-domain trust routes.

## Deferred

- Nostr public posting and relay publishing.
- Nostr profile kind `0` creation.
- Nostr key import, export, or external signer support.
- NIP-57 zaps and Lightning address support.
- NIP-47 / Nostr Wallet Connect.
- Any user-visible settings or profile labels.

## Open Decisions

- Automatic public mapping means every unlocked Veyl username becomes publicly resolvable to a Nostr pubkey at `glyphteck.com`. Confirm that this privacy/product tradeoff is accepted before implementing.
- Decide whether the production endpoint should serve only main/prod Veyl users. The safer default is yes; staging/regtest can use `dev.glyphteck.com` or another test domain for external validation.
- Decide whether Veyl should publish a default relay list in the NIP-05 `relays` object now or leave it absent until public posting exists.
