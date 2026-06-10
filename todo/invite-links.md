# Invite Links

status: active
branch: current
worktree: current
base: main@a9399c1a3eba
repo version: 0.14.12

## Scope

Add invite buttons in the app's person-picking flows so a user can copy a Veyl invite link when the intended recipient is not already available in search or recent people.

The copied link should preserve the invite context, not just open Veyl generically. Examples:

- chat with @alice
- pay @alice 37 USD
- request 37 USD from @alice
- receive the selected photo, file, or forwarded media

## Product Contract

- Use one shared invite link builder/parser. Prefer extending `shared/qr.js` and the existing `/qr` HTTPS wrapper unless the implementation proves a separate `shared/invite.js` owner is cleaner.
- Keep invite links as app links on the active Veyl host. Do not add a raw `veyl:` scheme or base64 JSON payload.
- Encode only the minimum public intent needed to resume the flow: invite kind, target username or typed handle when present, amount/currency for money flows, and a short action label for user-visible confirmation.
- Do not encode private chat message text, file bytes, wallet secrets, Spark ids, Firebase UIDs, encrypted payload bodies, or local cache keys in the link.
- Clipboard work stays platform-local: `navigator.clipboard.writeText` on web and `expo-clipboard` on iOS.

## Write Boundary

- Shared link contract: `shared/qr.js`, `shared/links.js`, and `guidelines/navigation.md`.
- Web entrypoints: `apps/web/src/components/peerselector.js`, `apps/web/src/components/dialogs/newchat.js`, `apps/web/src/components/dialogs/share.js`, `apps/web/src/components/sendmoney.js`, `apps/web/src/components/requestmoney.js`, `apps/web/src/components/dialogs/sendphoto.js`, and `apps/web/src/components/dialogs/sharemedia.js`.
- iOS entrypoints: `apps/ios/src/components/peerpicker.js`, `apps/ios/app/(vault)/(app)/peerselector.js`, `apps/ios/app/(vault)/(app)/transfer.js`, `apps/ios/app/(vault)/(app)/sendphoto.js`, and `apps/ios/app/(vault)/(app)/sharemedia.js`.
- Accept/resume paths: `apps/web/src/app/(authenticated)/(vault)/(app)/qr/page.js`, iOS QR/app-link handling, and the existing chat/payment routes needed to continue the action after signup, login, or vault unlock.

## Plan

1. Define a compact invite payload with explicit kinds for chat, send, request, send-media, and share-media.
2. Add shared helpers to make/read invite links through the existing Veyl `/qr` wrapper.
3. Add invite copy affordances to empty search states and selection footers where the current flow has enough context to invite someone.
4. Resume accepted invite links through the normal guarded route flow after auth, onboarding, and vault unlock. Root/auth shells should not learn app destinations.
5. Keep existing direct send/chat/share behavior unchanged when the selected person already has the required chat or wallet key.

## Handoff

No implementation has started. Before building, verify the current iOS universal-link route behavior for `/qr` so the parser lands in one shared flow across web and iOS.
