# Wallet Withdrawals And Fees

status: active
branch: main
worktree: current
base: main@3b0a6a0

## Scope

- Build shared fee infrastructure for funding and withdrawal flows before wiring full UI.
- Keep the first pass client-owned and non-custodial. No backend claims, no server-side wallet movement.
- Use current Spark SDK 0.8.0 docs and installed APIs.

## Plan

- Add pure helpers that normalize Spark withdrawal fee quotes into per-speed fee amounts.
- Keep Bitcoin market, block, and fee data in the public app-level Bitcoin provider, not the vault-gated wallet provider.
- Expose provider methods for withdrawal fee quotes only.
- Keep `withdrawFunds()` able to fetch its own fresh quote, but allow a caller to pass a previously reviewed quote id and fee amount.
- Store server-collected compact fee-rate data under `bitcoin/current.fees` so callers can estimate the sender's external L1 mining fee without client-side API calls.
- Add shared Lightning invoice/payment primitives, but do not expose them to UI until the product flow is reviewed.

## Notes

- Spark docs say `withdraw()` should use `feeQuoteId` and `feeAmountSats`; the older `feeQuote` param is deprecated.
- `npm view @buildonspark/spark-sdk version` returned `0.8.0`, matching the root catalog and lockfile.
- `getWithdrawalFeeQuote()` may restructure leaves while quoting, so UI should call it from explicit preview/confirm actions rather than on every keystroke.
- Funding sender L1 mining fees are paid by the external wallet. The backend only collects compact fee-rate data; callers must own any transaction-vsize assumptions. Spark static-deposit claims are auto-accepted, so the funding UI should use plain-language fee guidance instead of adding a manual deposit quote step.
- Lightning should probably be a separate dialog from the current on-chain withdrawal dialog. The shared primitives now support receive invoice creation, send fee estimates, payment execution, and send/receive request status polling.

## Original Items

- Integrate unilateral exit support.
- When a normal withdrawal is unavailable, automatically fall back to unilateral exit if it is available and appropriate.
- Clearly warn users before unilateral exit that it may cost more, take different timing, or carry any other relevant risks/tradeoffs.
- Add fee estimation so the fund-wallet flow can show approximately what a deposit may cost.
- Add fee estimation so withdrawal flows can show approximately what a withdrawal may cost before confirmation.
