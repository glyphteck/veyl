# Wallet Withdrawals And Fees

status: active
branch: main
worktree: current
base: main@3b0a6a0

## Scope

- Finish user-facing wallet fee surfaces without adding custodial backend behavior.
- Keep fee previews client-owned. No backend claims, no server-side wallet movement.

## Remaining Work

- Add explicit withdrawal-fee preview and confirmation UI on web and iOS.
- Keep `withdrawFunds()` able to fetch its own fresh quote, but prefer passing the quote id and fee amount that the user reviewed.
- Decide whether Lightning belongs in a separate dialog before exposing the shared Lightning primitives to UI.
- Revisit unilateral exit support and decide what warning copy and fallback behavior are appropriate.

## Notes

- Spark docs say `withdraw()` should use `feeQuoteId` and `feeAmountSats`; the older `feeQuote` param is deprecated.
- `getWithdrawalFeeQuote()` may restructure leaves while quoting, so UI should call it from explicit preview/confirm actions rather than on every keystroke.
- Funding sender L1 mining fees are paid by the external wallet. Keep funding UI in plain-language estimate territory unless the product needs a more exact transaction-size model.
