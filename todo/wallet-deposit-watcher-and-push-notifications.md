# Wallet Notifications

status: active
branch: current
worktree: current

## Decision

Use Spark wallet webhooks for event-driven wallet notifications after a wallet has registered them, but do not treat webhooks as a complete replacement for offline deposit watching.

Spark docs say wallets can register webhooks to notify completed events without polling and without read access to wallet transaction history. The docs also expose list and delete APIs and a five-webhook limit, so the registration appears to live on Spark's side after the wallet registers it. That means a registered webhook should still fire while the veyl app is backgrounded, locked, or not holding an initialized wallet object.

The gap is first registration. If no initialized client has registered a webhook for the wallet yet, Spark has no destination to call. This matters because veyl initializes wallets only while the user is actively using the app, and many users will lock the wallet on background. The reliable design is a hybrid:

- Spark webhooks cover Spark events after first successful registration, including when the client is later locked or offline.
- A thin server-side static-deposit address watcher covers on-chain funding deposits when webhook registration is missing, stale, or evicted.
- No server path should hold wallet seeds, wallet master keys, Spark signers, claim signatures, or authenticated readonly wallet access.

## Scope

- Notify users that wallet activity happened.
- Keep all fund-moving actions client-owned after vault unlock.
- Keep notification copy private and generic, such as `wallet activity` or `deposit ready`.
- Support iOS push first through the existing Expo push-token collection.
- Keep web foreground-only until a real browser push/PWA subscription model exists.
- Keep the server-side watcher narrow: static deposit address detection only, not full wallet history.

## Non-Goals

- Do not claim deposits on the server.
- Do not put wallet seeds, wallet master keys, claim signatures, Spark signers, or authenticated readonly wallet access on the server.
- Do not build a full centralized Spark wallet watcher.
- Do not rely on public readonly Spark polling for ghost wallets.
- Do not expose balances, amounts, addresses, tx ids, or wallet public keys in notification copy.
- Do not promise push notifications for a wallet that has never initialized enough to register a webhook or reveal a static funding address to the server.

## Reliability Model

- Already registered webhook, wallet currently locked/offline: should notify through Spark webhook.
- Wallet initialized after this feature ships: register or repair webhook during wallet boot, then background notifications should work.
- Existing user who has not unlocked since this feature shipped: no Spark webhook exists yet; no Spark push until next unlock.
- Static funding address known by server: scheduled watcher can notify for new on-chain deposits even if the wallet is currently locked.
- Static funding address not known by server: no reliable server-side deposit notification is possible without initializing the wallet once.
- Ghost wallet enabled: public Spark readonly polling cannot see wallet state, so do not use it for reliability.
- Authenticated readonly/master-key polling could see private wallet state, but it requires server-side wallet-owner key material and is rejected for veyl.

## Plan

1. Confirm the installed Spark SDK exposes `registerSparkWalletWebhook`, `listSparkWalletWebhooks`, and `deleteSparkWalletWebhook`, then verify the live webhook request shape, event id shape, and verification-secret behavior.
2. Extract the Expo push sender from chat push into `functions/lib/push.js`:
   - Keep `users/{uid}/push/{did}` as the token source.
   - Preserve stale-token disabling for `DeviceNotRegistered`.
   - Let chat and wallet notification code share the same push helper.
3. Add a server function that prepares a per-wallet webhook route after auth:
   - Input: active network and wallet identity public key.
   - Verify the wallet key belongs to the signed-in user's profile for that network.
   - Create or reuse a server route record keyed by `watchId = HMAC(serverSecret, network + walletPK)`.
   - Store uid, network, enabled state, per-watch webhook secret, route token, created/updated timestamps, and last registration status.
   - Return only the webhook URL, event list, and per-watch secret needed for the client to register with Spark.
4. During client wallet boot after unlock, call the prepare function and register the webhook from the initialized wallet:
   - Events: `SPARK_STATIC_DEPOSIT_FINISHED`, `SPARK_LIGHTNING_RECEIVE_FINISHED`, `SPARK_LIGHTNING_SEND_FINISHED`, and `SPARK_COOP_EXIT_FINISHED` unless the SDK/docs narrow the useful set.
   - Use `listSparkWalletWebhooks()` to avoid duplicate registrations when possible.
   - Re-register on each wallet boot if the stored registration is stale or missing.
   - Treat registration failure as non-fatal; foreground refresh still works when the user opens the app.
5. Add a public HTTPS webhook receiver:
   - Resolve the route by opaque route token or `watchId`.
   - Verify Spark's webhook secret/signature exactly as the SDK docs require.
   - Store an idempotent event record keyed by Spark event id if provided, otherwise by route plus event type plus timestamp bucket plus payload hash.
   - Never fetch wallet history, balance, UTXOs, or claim state from this function.
6. Add a narrow static deposit watch enrollment path:
   - When the client has an initialized wallet, ask for `getStaticDepositAddress()` once and enroll that address with the server.
   - Store the watch separately from the uid route. The watcher needs the address to query Bitcoin data, but general route records should still use HMAC ids and avoid exposing uid/address mappings in logs.
   - Treat this as service-side wallet notification data and document the privacy tradeoff.
7. Add a scheduled static-deposit watcher:
   - Poll watched static deposit addresses by shard/lease/backoff.
   - Detect new confirmed or sufficiently stable funding transactions.
   - Write idempotent `deposit ready` events.
   - Do not claim deposits, quote claims, fetch private wallet history, or infer balances.
   - Keep this watcher focused on L1 static deposits; Spark transfers and Lightning still depend on Spark webhooks.
8. Send iOS pushes using the existing `users/{uid}/push/{did}` tokens:
   - Push title/body should stay generic.
   - Push data should use a wallet route marker, for example `{ type: 'wallet' }`.
   - Reuse stale-token disabling behavior from chat push.
9. Route wallet pushes in iOS:
   - If the app is locked, route to the wallet/unlock path.
   - After unlock, refresh wallet state and run `claimDeposits()` when safe.
   - If already unlocked and active, avoid noisy banners and just refresh.
10. Keep web simple:
   - No browser push for this pass.
   - On unlock, focus, and app resume, refresh wallet state and claim deposits using the existing client-owned path.
   - Optionally show in-app wallet activity state from server event docs after unlock.
   - Later, add web push only if the product actually becomes a PWA-style web app.
11. Add admin/ops visibility without exposing mappings:
   - Counts by event type/status.
   - Last webhook time.
   - Registration failures by network.
   - Static watcher shard lag and retry age.
   - Delivery failure counts.
   - No raw walletPK, uid, address, amount, or transaction details in general logs.

## What Webhooks Replace

- No `SparkReadonlyClient.createPublic()` watcher is useful for ghost wallets because public clients get empty results.
- No `SparkReadonlyClient.createWithMasterKey()` watcher fits the security model because it requires server-side wallet-owner key material.
- No full Spark transaction watcher is needed for first implementation.
- No server-side claim/settlement path is needed.

## What The Static Deposit Watcher Adds

- It can notify about on-chain funding deposits when the app is locked and the Spark webhook is not registered or healthy.
- It does not require a wallet seed, master key, signer, or initialized wallet at event time.
- It only covers static L1 deposits to known funding addresses.
- It cannot notify for Spark-internal transfers or Lightning receives; those need Spark webhooks after first registration.
- It reduces privacy versus webhook-only because veyl's backend must know the static funding address it watches.

## Remaining Gaps

- Webhooks only exist after a user unlocks a wallet on a client that registers them at least once.
- Static deposit watches only exist after a client has generated and enrolled the funding address once.
- Webhook registration can be evicted or fail; the app must re-register on later unlocks and ops should alert on stale registrations.
- The webhook receiver can notify that activity happened, but it should not know detailed wallet state.
- If Spark does not include a stable event id, idempotency must be best-effort from route, event type, timestamp, and payload hash.
- Web users still only get foreground refresh until web push is intentionally added.
- Token transaction privacy is not solved by Spark Bitcoin privacy mode.

## Handoff

Before implementation, re-check the installed SDK method names and the current Spark webhook verification docs. The core direction is: register persistent Spark webhooks on wallet unlock, add a generic webhook-to-push relay, and add a narrow static-deposit address watcher for reliable deposit notifications when the wallet is locked or a webhook has not been registered yet.
