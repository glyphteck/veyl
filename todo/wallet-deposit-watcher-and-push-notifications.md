# Wallet Deposit Watcher And Push Notifications

status: active
branch: current
worktree: current

## Decision

Use two notification paths:

- Spark wallet webhooks for completed Spark wallet events after the user unlocks once and the initialized wallet registers its webhook.
- A scheduled Firebase Function for static on-chain deposits. After unlock, the client shares the active static funding address with the backend route. The scheduled watcher checks that known address for confirmed unclaimed UTXOs and sends a generic wallet push.

The deposit watcher is necessary because iOS cannot reliably poll while asleep and Spark's static-deposit webhook only arrives after the client wakes the wallet and completes the claim path.

## Scope

- Notify users that wallet activity happened.
- Keep notification copy private and generic, such as `wallet activity`, `deposit waiting`, or `deposit ready`.
- Support iOS push first through the existing APNs token collection.
- Keep web foreground-only until a real browser push/PWA subscription model exists.

## Constraints

- Do not claim deposits on the server.
- Do not put wallet seeds, wallet master keys, claim signatures, Spark signers, or authenticated owner readonly access on the server.
- Do not build a full centralized wallet state watcher.
- Do not expose balances, amounts, addresses, tx ids, or wallet public keys in notification copy.
- Do not add extra architecture for accounts whose wallets were never initialized.

## Reliability Model

- Existing user who has not unlocked since this feature shipped: no funding address or Spark webhook is registered yet, so no wallet push until next unlock.
- User unlocks after this feature ships: client prepares the server route, registers the Spark webhook, and stores the active funding address for background deposit watching.
- Wallet currently locked/offline: the scheduled funding-address watcher can still notify about confirmed unclaimed static deposits.
- Client remains responsible for claiming the deposit after unlock.

## Remaining Verification

- Confirm the scheduled watcher can query the live REGTEST funding address and dedupe repeated unclaimed UTXOs.
- Confirm a tapped chat push opens `/currentchat` for the sender after unlock.
- Confirm a tapped wallet push opens `/wallet` after unlock and triggers an immediate client wallet refresh/claim.
- Capture a real Spark webhook payload so receiver verification can be narrowed if Spark sends a more specific signature header than the current receiver accepts.

## Follow-Up

- For MAINNET, scan deposit addresses only when the observed Bitcoin block height changes. Keep REGTEST/LOCAL on a short schedule because block production is test-controlled and not mainnet-like.
