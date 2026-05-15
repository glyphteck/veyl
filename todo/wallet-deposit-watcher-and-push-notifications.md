# Wallet Deposit Watcher And Push Notifications

- Build deposit claiming around "notify the client to claim", not "claim on the server". The server must never hold wallet seeds, private keys, claim signatures, or any material that could move funds. The client keeps `claimDeposits()` as the only claim executor after the vault is unlocked.
- Preferred trigger path: use Spark wallet webhooks for Spark wallet activity and static-deposit availability. Register the webhook during wallet boot if Spark requires wallet-authenticated registration per identity, then keep the webhook URL, event list, and shared verification secret in functions config. The webhook should enqueue an idempotent wallet event and send a push, not do expensive synchronous work.
- Required fallback path: add a scheduled Firebase Function reconciliation job that scans watched Spark identities with `SparkReadonlyClient` / Spark indexed APIs, using `getUtxosForIdentity({ excludeClaimed: true, includePending: false })` for deposits.
- Do not build a raw Bitcoin block watcher unless Spark webhooks and Spark indexed read-only APIs prove insufficient.
- Store watch rows in a server-only collection keyed by `watchId = HMAC(serverSecret, network + walletPK)`, not by uid or raw address.
- Split routing from watching with `walletWatches/{watchId}` for wallet scan state and `walletWatchRoutes/{watchId}` for uid and notification settings.
- Keep event docs minimal and idempotent with private notification copy like `deposit ready` or `wallet activity`.
- iOS should route wallet pushes to the wallet screen, defer locked-vault actions until unlock, and run `claimDeposits()` when safe.
- Keep web foreground-only for now: unlock, focus, and app resume should refresh and claim.
- Start with scheduled reconciliation by HMAC bucket plus leases and backoff.
- Add admin/ops visibility with counts, status, retry age, and shard lag, without exposing user mappings.
- Before implementing, confirm current Spark webhook input shape and event names against installed SDK/docs.
