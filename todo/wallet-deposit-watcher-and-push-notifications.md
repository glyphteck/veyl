# Wallet Webhooks And Push Notifications

status: active
branch: current
worktree: current

## Decision

Use Spark wallet webhooks for event-driven wallet notifications after the user unlocks once and the initialized wallet registers its webhook.

Spark docs say wallets can register webhooks to notify completed events without polling and without read access to wallet transaction history. The installed SDK exposes `registerSparkWalletWebhook`, `listSparkWalletWebhooks`, and `deleteSparkWalletWebhook`; the registration input uses `event_types`. The docs also mention a five-webhook limit and duplicate suppression for the same URL/event set, so registration should be persistent on Spark's side after the wallet registers it.

This intentionally does not solve accounts whose wallet has never initialized. On first unlock after the feature ships, veyl checks a private user-doc tag for the active network. If the tag is missing, the client asks the backend for a webhook route, registers that URL with Spark from the initialized wallet, and then confirms registration so the backend tags the account.

## Scope

- Notify users that wallet activity happened.
- Keep all fund-moving actions client-owned after vault unlock.
- Keep notification copy private and generic, such as `wallet activity` or `deposit ready`.
- Support iOS push first through the existing Expo push-token collection.
- Keep web foreground-only until a real browser push/PWA subscription model exists.

## Non-Goals

- Do not claim deposits on the server.
- Do not put wallet seeds, wallet master keys, claim signatures, Spark signers, or authenticated readonly wallet access on the server.
- Do not build a full centralized Spark wallet watcher.
- Do not rely on public readonly Spark polling for ghost wallets.
- Do not expose balances, amounts, addresses, tx ids, or wallet public keys in notification copy.
- Do not add extra architecture for accounts whose wallets were never initialized.

## Reliability Model

- Already registered webhook, wallet currently locked/offline: should notify through Spark webhook.
- Wallet initialized after this feature ships: register webhook during wallet boot, then background notifications should work.
- Existing user who has not unlocked since this feature shipped: no Spark webhook exists yet; no Spark push until next unlock.
- User-doc tag present for the active network: skip registration on wallet boot.
- User-doc tag missing for the active network: prepare route, register Spark webhook, confirm tag.
- Ghost wallet enabled: public Spark readonly polling cannot see wallet state, so do not use it for reliability.
- Authenticated readonly/master-key polling could see private wallet state, but it requires server-side wallet-owner key material and is rejected for veyl.

## Plan

1. Confirm the live Spark webhook delivery shape and verification-secret behavior once a real webhook can be received.
2. Extract the Expo push sender from chat push into `functions/lib/push.js`:
   - Keep `users/{uid}/push/{did}` as the token source.
   - Preserve stale-token disabling for `DeviceNotRegistered`.
   - Let chat and wallet notification code share the same push helper.
3. Add a server function that prepares a per-wallet webhook route after auth:
   - Input: active network and wallet identity public key.
   - Verify the wallet key belongs to the signed-in user's profile for that network.
   - Create or reuse a server route record keyed by a stable hash of `network + walletPK`.
   - Store uid, network, enabled state, per-watch webhook secret, route token, created/updated timestamps, and last registration status.
   - Return only the webhook URL, event list, and per-watch secret needed for the client to register with Spark.
4. During client wallet boot after unlock, check `users/{uid}.walletNotifications[network].registered`:
   - If registered, do nothing.
   - If missing, call the prepare function and register the webhook from the initialized wallet.
   - Events: `SPARK_STATIC_DEPOSIT_FINISHED`, `SPARK_LIGHTNING_RECEIVE_FINISHED`, `SPARK_LIGHTNING_SEND_FINISHED`, and `SPARK_COOP_EXIT_FINISHED` unless the SDK/docs narrow the useful set.
   - Use `listSparkWalletWebhooks()` to avoid duplicate registrations when possible.
   - Confirm registration with the backend so it can tag the user doc.
   - Treat registration failure as non-fatal; foreground refresh still works when the user opens the app.
5. Add a public HTTPS webhook receiver:
   - Resolve the route by opaque route token or `watchId`.
   - Verify Spark's webhook secret/signature exactly as the SDK docs require.
   - Store an idempotent event record keyed by Spark event id if provided, otherwise by route plus event type plus timestamp bucket plus payload hash.
   - Never fetch wallet history, balance, UTXOs, or claim state from this function.
6. Send iOS pushes using the existing `users/{uid}/push/{did}` tokens:
   - Push title/body should stay generic.
   - Push data should use a wallet route marker, for example `{ type: 'wallet' }`.
   - Reuse stale-token disabling behavior from chat push.
7. Route wallet pushes in iOS:
   - If the app is locked, route to the wallet/unlock path.
   - After unlock, refresh wallet state and run `claimDeposits()` when safe.
   - If already unlocked and active, avoid noisy banners and just refresh.
8. Keep web simple:
   - No browser push for this pass.
   - On unlock, focus, and app resume, refresh wallet state and claim deposits using the existing client-owned path.
   - Optionally show in-app wallet activity state from server event docs after unlock.
   - Later, add web push only if the product actually becomes a PWA-style web app.
9. Add admin/ops visibility without exposing mappings:
   - Counts by event type/status.
   - Last webhook time.
   - Registration failures by network.
   - Delivery failure counts.
   - No raw walletPK, uid, address, amount, or transaction details in general logs.

## What Webhooks Replace

- No `SparkReadonlyClient.createPublic()` watcher is useful for ghost wallets because public clients get empty results.
- No `SparkReadonlyClient.createWithMasterKey()` watcher fits the security model because it requires server-side wallet-owner key material.
- No full Spark transaction watcher is needed for first implementation.
- No server-side claim/settlement path is needed.

## Remaining Gaps

- Webhooks only exist after a user unlocks a wallet on a client that registers them at least once.
- Webhook registration can be evicted or fail; this pass only retries when the user-doc tag is absent.
- The webhook receiver can notify that activity happened, but it should not know detailed wallet state.
- If Spark does not include a stable event id, idempotency must be best-effort from route, event type, timestamp, and payload hash.
- Web users still only get foreground refresh until web push is intentionally added.
- Token transaction privacy is not solved by Spark Bitcoin privacy mode.

## Handoff

Before or during live verification, capture a real Spark webhook payload so the receiver can tighten secret/header verification if Spark uses a documented header that is not currently in the docs.
