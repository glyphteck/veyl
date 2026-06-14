# Wallet Transfer Notifications

status: active
branch: current
worktree: current
base: main@7d56e720d7e5
repo version: 0.14.6

## Scope

Notify a user when a Veyl-to-Veyl transfer to them is confirmed without adding wallet custody or exposing wallet secrets to the backend.

## Open Item

- Send a generic push/inbox signal when a transfer to a user is confirmed so the recipient client can notice the wallet event without waiting on foreground polling.

Current source can remember locally claimed transfer ids from Spark wallet events, but there is still no backend recipient notification path for Veyl-to-Veyl transfers.

## Constraints

- Do not include amount, wallet public key, tx id, balance, memo, or other transfer details in notification copy.
- Do not store wallet seeds, Spark signers, static deposit addresses, or authenticated wallet read access on the server.
- Keep BTC deposit APNs separate; that feature remains paused because it requires an explicit opt-in address-watching privacy tradeoff.
