# External Payment QR Invoices

status: active
branch: main
worktree: current
base: main@4a25dfb4b338
repo version: 0.15.2

## Implementation Status

- Shared QR parsing now recognizes Veyl invoice links, raw BOLT11 Lightning invoices, `lightning:` invoice URIs, and Spark invoice strings.
- External Lightning receive QRs default to Veyl `/qr?l=...` app links so iOS root camera can open Veyl. An explicit Lightning toggle switches the rendered QR to `lightning:<bolt11>` for external Lightning wallet scanners.
- Shared wallet send helpers now pay external BOLT11 invoices with `preferSpark: true` and standalone Spark invoices with `fulfillSparkInvoice`.
- Web request QR generation now creates Lightning invoices with `includeSparkInvoice: true`, renders the current QR mode, and routes scanned external invoices through the payments send tab.
- Web and iOS receive QR surfaces no longer show copy buttons or waiting/payment status text. Lightning invoice mode can still copy by tapping/clicking the QR itself.
- In Lightning invoice mode, web and iOS receive QR surfaces silently poll invoice status, turn the QR active green when the invoice completes, refresh wallet data, then close the dialog/sheet.
- Invoice-backed receive QR surfaces now poll completion in both default Veyl-link mode and explicit Lightning QR mode, so the standard app-link QR also turns active green and closes after payment.
- Invoice-backed receive QR feedback now also treats a matching incoming completed wallet transfer after invoice creation as payment completion, covering SDK receive-status lag or stale receive request reads.
- Receive QR transfer fallback now only considers incoming transfers created after the QR instance is shown, so already-paid invoice transfers cannot immediately re-close a reopened QR.
- iOS wallet receive now creates a fresh invoice when the native receive sheet regains focus instead of reusing the previous sheet state.
- Receive QR completion now uses one shared wallet status predicate, and the QR feedback path is a simple active-green color change plus close timer instead of duplicated web CSS/iOS animation layers.
- iOS external transfer dropped dead loading/reset state that could not visibly run after the sheet dismissed; duplicate-tap protection stays in the local busy ref.
- Veyl app-link invoice QRs now carry receiver username/wallet metadata when available, and iOS invoice transfer sheets use that metadata for the avatar/label instead of showing the generic Lightning mark.
- iOS wallet receive now creates a dynamic zero-amount Lightning invoice with an embedded Spark invoice, supports amount-specific QR regeneration, defaults to a Veyl app-link QR, and exposes a small Lightning toggle for invoice QR mode.
- iOS camera scan and `/qr` route now recognize Lightning/Spark invoices and route them through the existing `/transfer` sheet.
- iOS `/transfer` now supports invoice-backed payments without Veyl peer lookup and uses a Lightning icon instead of a peer avatar for external invoice targets.
- iOS universal `/qr` payment links now store a pending QR intent, return to the normal unlocked app route, and let the `(app)` stack open `transfer` or `withdraw` as the existing bottom sheet instead of replacing the root QR route with a full page.
- iOS suppresses recently paid or in-flight Lightning/Spark invoice scans so the camera does not immediately reopen the same invoice after transfer closes.

## Scope

- Add QR receive support for external Lightning payments and external Spark payments on web and iOS.
- Make payment receive QR codes Veyl app links by default so OS cameras open Veyl, with an explicit Lightning invoice mode for external Lightning wallets.
- Use one payment QR code surface for BTC receive from anywhere. Do not add a primary Spark-only QR mode.
- Keep Veyl chat payment requests separate from external receive invoices unless a later product pass deliberately links them.
- Keep wallet receive state client-owned. Do not add custodial backend payment state or server-side wallet movement.

## Crawl Findings

- Spark MCP docs say `createLightningInvoice({ includeSparkInvoice: true })` embeds a Spark invoice in the BOLT11 routing hints so Spark-compatible wallets can pay over Spark while non-Spark wallets pay the same invoice over Lightning. This keeps the payment correlated to the receive request.
- Spark MCP docs also say `includeSparkAddress` is mutually exclusive with `includeSparkInvoice`; if a payer uses the fallback Spark address, the payment is not correlated to the invoice and appears as a separate Spark transfer. Use `includeSparkInvoice`, not `includeSparkAddress`, for QR invoices.
- Spark MCP docs say zero-amount Lightning invoices are supported through `amountSats: 0`, but they are not widely supported by all Lightning senders. Product direction is still to support zero-amount receive because Veyl can already handle amount entry on pay.
- Spark MCP docs show standalone Spark invoices through `createSatsInvoice`, `fulfillSparkInvoice`, and `querySparkInvoices`. They are receiver-signed, can carry amount, memo, expiry, and payment status, and can be displayed directly as QR for Spark-native payers.
- The installed Spark SDK matches the docs: `createLightningInvoice` accepts `includeSparkInvoice`, validates the embedded Spark invoice, `payLightningInvoice` can use `preferSpark`, `fulfillSparkInvoice` pays Spark invoice strings, and normal `transfer()` rejects Spark invoice addresses.
- `shared/wallet/lightning.js` already exposes `createLightningInvoice`, `sendLightningPayment`, and `getLightningReceiveRequest` through the shared wallet provider. `normalizeLightningReceiveRequest` already keeps `encodedInvoice`, `paymentHash`, `expiresAt`, and `sparkInvoice`.
- Web request QR currently comes from `apps/web/src/components/requestmoney.js` through `makeRequestQr`, then `apps/web/src/components/dialogs/qrcode.js` renders `makeQr(data)`. That produces a Veyl `/qr?...` app link, not a BOLT11 or Spark invoice.
- Web QR scanning and `/qr` routing only understand Veyl user links, Veyl request links, and Bitcoin on-chain addresses. BOLT11 invoices and Spark invoices are not parsed as payment targets.
- iOS has `apps/ios/app/(vault)/(app)/fundwallet.js` for static on-chain funding QR and `apps/ios/app/(vault)/(app)/userscan.js` for user QR. There is no dynamic Lightning/Spark invoice receive screen like web's request QR button.
- iOS scanner and `/qr` route mirror web's current contract: Veyl user/request links and Bitcoin on-chain addresses only. They route Veyl request links to `/transfer`, not to a Lightning/Spark invoice payment review.

## Write Boundary

- `shared/qr.js`: add native payment QR support for raw BOLT11 invoices and Spark invoice strings, while keeping Veyl app links for user/chat flows.
- `shared/wallet/lightning.js`, `shared/wallet/fees.js`, and possibly a new shared wallet receive helper: create a single external receive API that defaults to `includeSparkInvoice: true`, normalizes status, and refreshes wallet data after payment completion.
- `shared/wallet/send.js` or a sibling payment helper: add a clean path for paying scanned BOLT11 invoices with `preferSpark: true` and for paying scanned standalone Spark invoices with `fulfillSparkInvoice`.
- Web receive surfaces: `apps/web/src/components/requestmoney.js`, `apps/web/src/components/dialogs/qrcode.js`, `apps/web/src/components/dialogs/payments.js`, funding/wallet menu entry points, scanner handling, and `/qr` route handling.
- iOS receive surfaces: add or adapt a receive route/sheet near `fundwallet`, wire wallet/payment entry points, render invoice QR, and keep status confirmation outside the QR surface.
- iOS scanner and QR route: recognize BOLT11 and Spark invoice QR payloads and route to a payment review/pay flow instead of requiring a Veyl profile lookup.
- Durable docs after implementation: update the focused wallet/QR guidance if this creates a stable receive contract.

## Plan

1. Define the shared QR contract.
   - Keep `qr.user`, Veyl invite links, and in-chat request links as app links.
   - Add native payment QR kinds for Lightning invoice strings and Spark invoice strings.
   - Have `makeQr` return a Veyl app link for Lightning receive codes by default so root camera scans can open Veyl.
   - Keep `makeLightningInvoiceQr` as the explicit external-wallet QR mode that returns `lightning:<bolt11>`.
   - Have `readQr` recognize Veyl invoice links, BOLT11 invoice prefixes, `lightning:` invoice URIs, and Spark invoice strings before falling back to Bitcoin on-chain addresses.
   - Preserve Veyl app-link fallback behavior for unsupported scan cases where possible instead of making the scan dead-end.

2. Add shared wallet primitives.
   - Create a receive helper that calls `createLightningInvoice({ amountSats, memo, expirySeconds, includeSparkInvoice: true })`.
   - Allow `amountSats: 0` for zero-amount receive.
   - Return the BOLT11 invoice as the underlying receive credential, render it as a Veyl app link by default, and expose the raw Lightning URI only through the explicit QR toggle.
   - Keep receive-status text out of the QR surface; for Lightning invoice mode, silently poll completion, turn the QR active green, refresh wallet data, and close the surface.
   - Add a payer helper for scanned invoice strings: BOLT11 uses `sendLightningPayment({ invoice, preferSpark: true })`; standalone Spark invoice uses `wallet.fulfillSparkInvoice`.

3. Replace web external receive QR behavior.
   - Stop using chat request links for external receive QR.
   - Add an invoice receive UI that can generate amount-specific or zero-amount BOLT11 invoices with embedded Spark invoice and renders a Veyl app-link QR by default.
   - Add a small Lightning button that switches the visible QR to a standard `lightning:<bolt11>` invoice URI.
   - Do not show waiting/payment status or a separate copy button on the QR surface. If copy is needed, make the QR itself copy the current value, primarily in Lightning invoice mode.
   - When the Lightning invoice is paid, turn the QR active green and close the dialog.
   - Keep chat request messages using `makeReq` and `pay_confirm`; do not use invoice status as chat payment truth.
   - Update web scan and `/qr` handling to detect external invoices and open a pay/review path.

4. Add iOS dynamic invoice receive.
   - Add a receive route or sheet parallel to `fundwallet` instead of only showing a static on-chain address.
   - Support amount entry, invoice generation, Veyl-default QR render, and Lightning QR toggle.
   - Do not show waiting/payment status or a separate copy button on the QR surface. If copy is needed, make the QR itself copy the current value, primarily in Lightning invoice mode.
   - When the Lightning invoice is paid, turn the QR active green and close the sheet.
   - Preserve on-chain funding as an explicit option, but make external Lightning/Spark receive easy to find from wallet entry points.

5. Add iOS external invoice pay handling.
   - Update camera scan and `/qr` route parsing for BOLT11 and Spark invoice payloads.
   - Route scanned invoices through the existing `/transfer` flow, expanded to support invoice-backed payment targets instead of only profile `walletPK` sends.
   - For external invoice targets, show invoice/payment identity instead of a user avatar, for example a Lightning icon plus a receiver address or invoice label.
   - Use `preferSpark: true` for BOLT11 so embedded Spark invoices pay over Spark when possible.
   - Suppress recently paid or in-flight Lightning/Spark invoice scans on iOS so returning to camera does not reopen the same proper invoice.

## Product Decisions

- Payment receive QR should become external invoices wherever users expect to receive from outside Veyl.
- Zero-amount receive is supported in the first pass. If a scanner or payer cannot handle a zero-amount Lightning invoice, route to the app or another existing fallback rather than adding a complex second receive UX.
- A single QR cannot reliably be both a universal/app link and a directly payable Lightning invoice for every OS camera and wallet scanner. Prioritize Veyl by default.
- Show one payment QR code surface for BTC receive from anywhere. The small Lightning button changes the QR payload in place; do not add visible Lightning-vs-Spark QR modes.
- Reuse and generalize the existing transfer flow for scanned external invoices instead of creating a separate invoice review route.
- Universal-link QR scans should return to the normal unlocked app route and open transfer/withdraw as existing bottom sheets, not as full-page replacements from the root `/qr` bridge.
- Proper invoice scans may be suppressed after payment because the invoice string is a stable one-time credential; Veyl request links should not use that suppression path.
- Keep in-chat request messages as simple `req` payloads and signed `pay_confirm` actions for now.

## Open Decisions

- On-chain receive is no longer the first-tap wallet receive sheet in this first implementation. Add a separate explicit on-chain receive option later if the wallet still needs an easy static deposit address path.
- Exact zero-amount fallback mechanics: BOLT11 zero-amount with embedded Spark invoice is the first attempt, but implementation should decide whether unsupported scans fall back to app link handling, Spark invoice fulfillment, or an amount-entry transfer screen.
- Whether received invoice status should remain screen-local only or get a small in-memory wallet receive list while the app stays unlocked. Avoid durable backend or plaintext local cache state unless a later design needs it.
- Future only: whether chat request messages should eventually carry invoice data. Keep this in mind but do not change chat request semantics in this task.

## Validation

- Completed after Veyl-first QR correction: `bun --filter @veyl/shared lint`
- Completed after Veyl-first QR correction: `bun --filter @glyphteck/veyl-web lint`
- Completed after Veyl-first QR correction: `bun --filter @glyphteck/veyl-ios lint`
- Completed after QR sheet/status correction: `bun --filter @veyl/shared lint`
- Completed after QR sheet/status correction: `bun --filter @glyphteck/veyl-web lint`
- Completed after QR sheet/status correction: `bun --filter @glyphteck/veyl-ios lint`
- Completed after Lightning completion/suppression correction: `bun --filter @veyl/shared lint`
- Completed after Lightning completion/suppression correction: `bun --filter @glyphteck/veyl-web lint`
- Completed after Lightning completion/suppression correction: `bun --filter @glyphteck/veyl-ios lint`
- Completed after QR feedback/user-metadata correction: `bun --filter @veyl/shared lint`
- Completed after QR feedback/user-metadata correction: `bun --filter @glyphteck/veyl-web lint`
- Completed after QR feedback/user-metadata correction: `bun --filter @glyphteck/veyl-ios lint`
- Completed after QR transfer-fallback feedback correction: `bun --filter @veyl/shared lint`
- Completed after QR transfer-fallback feedback correction: `bun --filter @glyphteck/veyl-web lint`
- Completed after QR transfer-fallback feedback correction: `bun --filter @glyphteck/veyl-ios lint`
- Completed after reverting local iOS amount input metric override: `bun --filter @glyphteck/veyl-ios lint`
- Completed after paid-invoice reuse correction: `bun --filter @veyl/shared lint`
- Completed after paid-invoice reuse correction: `bun --filter @glyphteck/veyl-web lint`
- Completed after paid-invoice reuse correction: `bun --filter @glyphteck/veyl-ios lint`
- Completed after QR/payment code-efficiency cleanup: `bun --filter @veyl/shared lint`
- Completed after QR/payment code-efficiency cleanup: `bun --filter @glyphteck/veyl-web lint`
- Completed after QR/payment code-efficiency cleanup: `bun --filter @glyphteck/veyl-ios lint`
- Manual web test: generate amount invoice, scan/copy in external Lightning wallet, confirm `TRANSFER_COMPLETED`, confirm wallet balance/history refresh.
- Manual Spark test: pay the generated BOLT11 from a Spark-compatible payer and confirm it uses the embedded Spark invoice; separately test standalone Spark invoice if exposed.
- Manual iOS test on device: generate receive QR, tap-copy Lightning mode, scan BOLT11, scan Spark invoice, and verify route handling from universal `/qr` links.
