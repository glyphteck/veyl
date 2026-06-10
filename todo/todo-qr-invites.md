# QR Invites

status: active
branch: current
worktree: current
base: main@current
repo version: 0.14.12

- Make `/qr` a full invite surface for unauthenticated, locked, and new users, not only an app-internal handler after auth and vault unlock.
- Preserve the original QR/invite payload through landing, download, login, onboarding, vault creation, and unlock, then resume the intended user/chat/payment action.
- Add invite buttons anywhere a peer can be selected: new chat, send money, request money, payment dialogs, profile/user QR surfaces, camera/media recipient selection, and empty chat states.
- Add public payment-request landing pages that render context before account creation, e.g. `@zak requested 2,500 sats on Veyl`, with actions for existing Veyl users, new accounts, app open/download, and external Bitcoin wallet fallback where possible.
- Turn `/download` into a real mobile invite continuation page with App Store/open-app/browser choices and preserved invite state.
- Keep user QR, payment-request QR, and Bitcoin-address QR behavior compatible with `shared/qr.js`; add fixtures for build, parse, unauthenticated resume, locked resume, and post-onboarding resume cases.
