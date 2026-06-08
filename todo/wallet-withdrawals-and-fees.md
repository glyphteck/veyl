# Wallet Withdrawals And Fees

status: active
branch: main
worktree: current
base: main@7d56e720d7e5
repo version: 0.14.6

## Scope

- Finish user-facing wallet fee surfaces without adding custodial backend behavior.
- Keep fee previews client-owned. No backend claims, no server-side wallet movement.

## Remaining Work

- Replace the current static withdrawal-fee estimate with an explicit Spark quote review and confirmation UI on web and iOS.
- Decide how the review step should mask or explain temporary balance churn from Spark leaf restructuring during `getWithdrawalFeeQuote()`.
- Decide whether Lightning belongs in a separate dialog before exposing the shared Lightning primitives to UI.
- Revisit unilateral exit support and decide what warning copy and fallback behavior are appropriate.

## Notes

- Spark docs say `withdraw()` should use `feeQuoteId` and `feeAmountSats`; the older `feeQuote` param is deprecated.
- `getWithdrawalFeeQuote()` may restructure leaves while quoting, so UI should call it from explicit preview/confirm actions rather than on every keystroke.
- Shared wallet code exposes `prepareWithdrawal()` for the first press and `confirmWithdrawal()` for the reviewed second press. The current web and iOS withdrawal UI is not wired to those yet.
- The current web and iOS UI shows an estimated network/export fee from static fee assumptions, then still calls `withdrawFunds()` directly on submit.
- Funding sender L1 mining fees are paid by the external wallet. Keep funding UI in plain-language estimate territory unless the product needs a more exact transaction-size model.
