# Wallet Deposit Watcher And Push Notifications

status: active
branch: current
worktree: current

## Decision

Use one active notification path:

- Spark wallet webhooks for completed Spark wallet events after the user unlocks once and the initialized wallet registers its webhook.

Static on-chain deposit APNs are paused. Reliable offline deposit alerts require Veyl or another server-side party to know the user's static Bitcoin funding address. That is an explicit privacy tradeoff and should not happen by default.

## Scope

- Notify users that wallet activity happened.
- Keep notification copy private and generic, such as `wallet activity`, `deposit waiting`, or `deposit ready`.
- Support iOS push first through the existing APNs token collection.
- Keep web foreground-only until a real browser push/PWA subscription model exists.
- Keep static Bitcoin deposit APNs out of this task; `todo/btc-apns.md` records the paused opt-in path.

## Constraints

- Do not claim deposits on the server.
- Do not put wallet seeds, wallet master keys, claim signatures, Spark signers, or authenticated owner readonly access on the server.
- Do not build a full centralized wallet state watcher.
- Do not expose balances, amounts, addresses, tx ids, or wallet public keys in notification copy.
- Do not add extra architecture for accounts whose wallets were never initialized.
- Do not store static funding addresses unless a future explicit opt-in setting is added.

## Reliability Model

- Existing user who has not unlocked since this feature shipped: no Spark webhook is registered yet, so no wallet push until next unlock.
- User unlocks after this feature ships: client prepares the server route and registers the Spark webhook.
- Wallet currently locked/offline: static on-chain deposit pushes are not reliable without opt-in address watching.
- Client remains responsible for claiming the deposit after unlock.

## Remaining Verification

- Confirm a tapped chat push opens `/currentchat` for the sender after unlock.
- Confirm a tapped wallet push opens `/wallet` after unlock and triggers an immediate client wallet refresh/claim.
- Capture a real Spark webhook payload so receiver verification can be narrowed if Spark sends a more specific signature header than the current receiver accepts.
