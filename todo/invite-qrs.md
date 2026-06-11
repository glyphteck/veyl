# QR App Links

status: active
branch: current
worktree: current
base: main@current
repo version: 0.14.12

## Scope

Make Veyl-owned QR codes behave as app links when scanned outside the app:

1. If a Veyl build is installed, iOS should open the highest-priority installed build on the QR route: production first, then test, then dev.
2. If no Veyl build is installed, the QR should open the website.
3. If Veyl is not installed and the website is opened on mobile `/qr`, mobile web should land on `/download`.
4. If the QR is scanned inside Veyl, the in-app scanner should handle the payload directly without leaving the app.

This is separate from invite links. QR codes wrap existing Veyl actions; invite links are growth links created from peer-selection UI.

## Current Contract

Shared QR owner: `shared/qr.js`

Veyl-owned QR payloads use canonical base-host HTTPS app-link wrappers:

- user QR: `/qr?u=<username>`
- payment request QR: `/qr?r=<walletPK>&a=<sats>`

Mobile web fallback intentionally drops the QR context because the App Store handoff loses it anyway.

The Apple app-site association file should list app IDs in production, test, dev order for `/qr` and root invite links. Do not implement a JavaScript app-open probing loop.

Bitcoin funding QR currently stays `bitcoin:<address>` because that QR is meant to be scanned by external Bitcoin wallets. Changing it to a Veyl app link would make funding from another wallet worse unless a separate copy/open-wallet affordance replaces that behavior.

## Write Boundary

- `shared/qr.js`
- `apps/web/src/proxy.js`
- `apps/web/src/app/download/page.js`
- `apps/web/src/app/(authenticated)/(vault)/(app)/qr/page.js`
- `apps/ios/app/(vault)/qr.js`
- `apps/ios/src/lib/camera/scan.js`
- `apps/web/src/lib/camera/scan.js`
- `guidelines/navigation.md`

## Plan

1. Verify all Veyl-owned QR generators use `makeQr()` and emit canonical base-host `/qr?...` app links.
2. Keep mobile web redirects sending `/qr?...` to generic `/download`.
3. Keep `/download` generic until the App Store redirect is wired.
4. Verify iOS associated domains open `/qr` in the highest-priority installed app on standalone builds.
5. Decide separately whether Bitcoin funding QR should remain `bitcoin:` or get a second Veyl app-link QR option.
6. Add fixtures for user QR, payment-request QR, Bitcoin funding QR, mobile fallback, and in-app scanner parsing.

## Acceptance Criteria

- User and payment-request QR codes scan into Veyl when the app is installed.
- If multiple Veyl builds are installed, the production app opens before test, and test opens before dev.
- User and payment-request QR codes land on the generic download fallback when the app is not installed.
- The original `/qr?...` payload is not preserved through `/download`.
- In-app web and iOS scanners keep handling QR payloads directly.
- Bitcoin funding QR behavior is intentionally decided instead of accidentally broken.
