# Wallet Transfer Notifications

status: active
branch: current
worktree: current

## Scope

Notify a user when a Veyl-to-Veyl transfer to them is confirmed without adding wallet custody or exposing wallet secrets to the backend.

## Open Item

- Send a generic push/inbox signal when a transfer to a user is confirmed so the recipient client can notice the wallet event without waiting on foreground polling.

## Constraints

- Do not include amount, wallet public key, tx id, balance, memo, or other transfer details in notification copy.
- Do not store wallet seeds, Spark signers, static deposit addresses, or authenticated wallet read access on the server.
- Keep BTC deposit APNs separate; that feature remains paused because it requires an explicit opt-in address-watching privacy tradeoff.
