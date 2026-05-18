# Wallet Webhooks And Push Notifications

status: active
branch: current
worktree: current

## Decision

Use Spark wallet webhooks as the primary wallet-activity notification path. Do not build a centralized read-only wallet watcher first.

Spark docs say wallet webhooks can notify completed wallet events without polling and without read access to the wallet's transaction history. That fits the current architecture better than a public `SparkReadonlyClient` watcher because `ghost wallet` makes public read-only queries return empty results, and authenticated read access would require server-side wallet seed, master-key, or signer access that veyl should not hold.

## Scope

- Notify users that wallet activity happened.
- Keep all fund-moving actions client-owned after vault unlock.
- Keep notification copy private and generic, such as `wallet activity` or `deposit ready`.
- Support iOS push first through the existing Expo push-token collection.
- Keep web foreground-only until a real browser push/PWA subscription model exists.

## Non-Goals

- Do not claim deposits on the server.
- Do not put wallet seeds, wallet master keys, claim signatures, Spark signers, or authenticated readonly wallet access on the server.
- Do not build a raw Bitcoin block watcher unless Spark webhooks prove insufficient.
- Do not rely on public readonly Spark polling for ghost wallets.
- Do not expose balances, amounts, addresses, tx ids, or wallet public keys in notification copy.

## Plan

1. Confirm the installed Spark SDK exposes `registerSparkWalletWebhook`, `listSparkWalletWebhooks`, and `deleteSparkWalletWebhook`, then verify the live webhook request shape and verification-secret behavior.
2. Add a server function that prepares a per-wallet webhook route after auth:
   - Input: active network and wallet identity public key.
   - Verify the wallet key belongs to the signed-in user's profile for that network.
   - Create or reuse a server route record keyed by `watchId = HMAC(serverSecret, network + walletPK)`.
   - Store uid, network, enabled state, per-watch webhook secret, route token, created/updated timestamps, and last registration status.
   - Return only the webhook URL, event list, and per-watch secret needed for the client to register with Spark.
3. During client wallet boot after unlock, call the prepare function and register the webhook from the initialized wallet:
   - Events: `SPARK_STATIC_DEPOSIT_FINISHED`, `SPARK_LIGHTNING_RECEIVE_FINISHED`, `SPARK_LIGHTNING_SEND_FINISHED`, and `SPARK_COOP_EXIT_FINISHED` unless the SDK/docs narrow the useful set.
   - Use `listSparkWalletWebhooks()` to avoid duplicate registrations when possible.
   - Treat registration failure as non-fatal; foreground refresh still works when the user opens the app.
4. Add a public HTTPS webhook receiver:
   - Resolve the route by opaque route token or `watchId`.
   - Verify Spark's webhook secret/signature exactly as the SDK docs require.
   - Store an idempotent event record keyed by Spark event id if provided, otherwise by route plus event type plus timestamp bucket plus payload hash.
   - Never fetch wallet history, balance, UTXOs, or claim state from this function.
5. Send iOS pushes using the existing `users/{uid}/push/{did}` tokens:
   - Push title/body should stay generic.
   - Push data should use a wallet route marker, for example `{ type: 'wallet' }`.
   - Reuse stale-token disabling behavior from chat push.
6. Route wallet pushes in iOS:
   - If the app is locked, route to the wallet/unlock path.
   - After unlock, refresh wallet state and run `claimDeposits()` when safe.
   - If already unlocked and active, avoid noisy banners and just refresh.
7. Keep web simple:
   - No browser push for this pass.
   - On unlock, focus, and app resume, refresh wallet state and claim deposits using the existing client-owned path.
   - Later, add web push only if the product actually becomes a PWA-style web app.
8. Add admin/ops visibility without exposing mappings:
   - Counts by event type/status.
   - Last webhook time.
   - Registration failures by network.
   - Delivery failure counts.
   - No raw walletPK, uid, address, amount, or transaction details in general logs.

## What Webhooks Replace

- No scheduled HMAC-bucket scan is required for first implementation.
- No `SparkReadonlyClient.createPublic()` watcher is useful for ghost wallets because public clients get empty results.
- No `SparkReadonlyClient.createWithMasterKey()` watcher fits the security model because it requires server-side wallet-owner key material.
- No raw address block watcher is needed unless Spark webhooks fail to cover static deposits in practice.

## Remaining Gaps Versus A Centralized Watcher

- Webhooks only exist after a user unlocks a wallet on a client that registers them at least once.
- Webhook registration can be evicted or fail; the app must re-register on later unlocks.
- The webhook receiver can notify that activity happened, but it should not know detailed wallet state.
- If Spark does not include a stable event id, idempotency must be best-effort from route, event type, timestamp, and payload hash.
- Web users still only get foreground refresh until web push is intentionally added.
- Token transaction privacy is not solved by Spark Bitcoin privacy mode.

## Handoff

Before implementation, re-check the installed SDK method names and the current Spark webhook verification docs. The core direction is settled: start with wallet-authenticated webhook registration plus generic push routing, and keep scheduled readonly reconciliation as a later fallback only if webhook reliability is insufficient.
