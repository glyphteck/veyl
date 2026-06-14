# BTC APNs

status: paused
branch: current
worktree: current
base: main@7d56e720d7e5
repo version: 0.14.6

## Decision

Do not implement `btc apns` right now.

The requirement is: notify users when an on-chain Bitcoin deposit lands and is ready to claim, without Veyl directly storing or tracking each user's static funding address. Current Spark static-deposit behavior does not appear to support that cleanly.

The only reliable APNs path Veyl can build today requires a backend watcher that stores the user's static Bitcoin funding address, checks it for unclaimed deposits, and sends APNs. That directly creates the privacy risk this task is trying to avoid.

## Source Checks

- Spark static deposit addresses are reusable and currently one static address is supported per wallet.
- Spark says apps must monitor static deposit addresses with a block explorer or their own infrastructure.
- Spark says `claimStaticDeposit` succeeds by default after 3 L1 confirmations.
- Spark says 0-1 confirmation settlement is available only by arrangement with Spark.
- Spark says static deposits do not auto-claim when the wallet is offline; the wallet must claim after it is initialized again.
- Spark notes the minimum deposit must exceed dust plus fees, with dust around 400 sats and claim fee around 99 sats, so deposits below roughly 500 sats can fail.
- Spark CLI exposes `getutxosfordepositaddress`, but that still requires knowing the deposit address being watched.
- Expo BackgroundTask uses iOS `BGTaskScheduler`; iOS chooses when tasks run, may delay them, and stops background tasks if the user kills the app. This is not a reliable deposit-notification source.

Docs:

- https://docs.spark.money/wallets/deposit-from-l1
- https://docs.spark.money/api-reference/wallet/get-static-deposit-address
- https://docs.spark.money/tools/cli
- https://docs.expo.dev/versions/latest/sdk/background-task
- https://developer.apple.com/documentation/uikit/using-background-tasks-to-update-your-app

## Rejected Path

Do not build a default backend BTC watcher that stores every user's static funding address.

Reasons:

- It links Veyl account identity to a reusable Bitcoin deposit address.
- It can expose deposit history for that address if backend data or logs leak.
- It conflicts with the privacy expectation around `ghost wallet`.
- It is still not the wallet source of truth; the client must unlock and claim.
- It adds backend surface area for a convenience feature rather than a required wallet capability.

## Acceptable Future Path

Only reconsider `btc apns` as an explicit opt-in feature with clear privacy copy.

If implemented later:

- Setting name: `btc apns`.
- Copy must say Veyl can notify when Bitcoin arrives, but this shares the user's static funding address with Veyl so the backend can watch it.
- Keep it off by default.
- Disable it or require a stronger warning when `ghost wallet` is enabled.
- Use Spark read-only `getUtxosForDepositAddress` first; do not build a Bitcoin block/address crawler unless Spark read-only cannot provide enough signal.
- Use the existing BTC block-height update only as a mainnet scan trigger.
- Keep REGTEST/LOCAL on a separate scheduled Spark read-only watcher for dev convenience.
- Notification copy must stay generic and must not include address, amount, txid, vout, balance, or wallet public key.

## Current Product Direction

Optimize the client-owned deposit path instead:

1. Claim once on wallet unlock after the Spark wallet is initialized.
2. Claim once when the app returns to foreground.
3. Claim once when the wallet screen opens.
4. Keep a bounded foreground claim retry while unlocked, but avoid aggressive always-on polling.
5. Surface a quiet in-app pending/claiming state when a claim check is running.
6. Do not rely on iOS background execution for correctness; use it only as a best-effort warmup if added later.

Current source keeps this client-owned: `shared/wallet/claims.js` claims while unlocked, prefers Spark identity UTXO reads when available, and falls back to funding-address UTXO reads. It does not add a backend static-address watcher or BTC deposit push path.

## Open Questions

- Can Spark provide a privacy-preserving webhook for static deposit readiness that does not require Veyl to store the user's funding address?
- Can Spark expose a wallet-owned event stream that fires when a static deposit reaches the default 3-confirmation claim threshold, even while the client wallet is offline?
- Is it worth adding a best-effort iOS BackgroundTask for claim checks, knowing it cannot guarantee timing and will not run after user-terminated app state?
