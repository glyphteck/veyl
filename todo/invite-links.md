# Invite Links

status: active
branch: current
worktree: current
base: main@a9399c1a3eba
repo version: 0.14.12

## Scope

Add copy/share invite buttons in peer-selection flows so a user can invite someone who is not already available through search or recent people.

This is separate from QR codes. QR codes are scan/open wrappers for existing Veyl actions. Invite links are growth links intentionally written to make a recipient want to create or open a Veyl account.

## Product Contract

Use one shared invite link builder/parser, likely `shared/invite.js`. Do not extend `shared/qr.js` for this feature.

Invite links should be HTTPS app links on the canonical base Veyl host. Do not add raw `veyl:` schemes, base64 JSON payloads, Firebase UIDs, wallet secrets, Spark ids, private chat text, encrypted payloads, media bytes, or local cache keys.

Do not route invite state through `/download`. The App Store handoff loses context, so `/download` stays generic; root metadata is the contextual growth surface.

Encode only public intent:

- invite kind
- inviter username when known
- typed recipient handle when useful
- amount/currency for send/request flows
- optional public source marker such as `faucet`, `review`, `profile`, or `peer-picker`

Clipboard/share work stays platform-local:

- web: `navigator.clipboard.writeText`
- iOS: `expo-clipboard` or native share sheet where the surface already uses sharing

## Link Shape

Use root app links with invite query params. Root still owns routing; the query changes paste-preview metadata and gives the unlocked app a public intent to resume.

- generic: `/?invite=1`
- from a user: `/?from=<username>`
- chat: `/?kind=chat&from=<username>`
- send: `/?kind=send&from=<username>&a=<amount>&c=<sats|btc|usd>`
- request: `/?kind=request&from=<username>&a=<amount>&c=<sats|btc|usd>`
- media: `/?kind=media&from=<username>`
- faucet demo: `/?kind=faucet-demo`

Future private or one-time invite codes can be added only if the backend needs state. Start stateless.

## Copy

The headline should explain the exact social action before signup.

Preferred headlines:

- `@zak invited you to Veyl`
- `@zak wants to chat privately with you on Veyl`
- `@zak wants to send you 2,500 sats on Veyl`
- `@zak requested 2,500 sats on Veyl`
- `@zak shared private media on Veyl`
- `Try Veyl with @faucet`

Support copy:

> Veyl is private chat with Bitcoin payments built in.

Short hook where space allows:

> Send sats inside private chat.

CTA labels:

- Open in Veyl
- Continue to private chat
- Pay with Veyl
- Request with Veyl
- Create account
- Copy invite link
- Share invite

Avoid generic growth copy such as "Join Veyl", "Open app", "Sign up now", or "Claim free sats". For `@faucet`, frame it as demo liquidity, not a signup reward:

> Send a tiny request to @faucet and see private chat plus Bitcoin settlement in one flow. Limited demo budget.

## User Experience

When a user taps invite in a peer-selection flow:

1. Build the narrowest invite payload for the current action.
2. Copy or share the canonical base-host root invite link.
3. Show a short confirmation with the exact action, not just "copied".
4. Keep the current peer-selection flow open so the user can still pick an existing peer.

Empty states should make invite obvious:

- no search result for `alice` -> `Invite alice`
- no recent people -> `Invite someone`
- no chat peer -> `Copy private chat invite`
- no payment recipient -> `Copy payment invite`
- no media recipient -> `Copy media invite`

Selection footers should include invite only when the flow has enough context to produce a useful link.

## Resume Contract

Opening an invite should preserve intent through:

- app open
- login
- new account creation
- username onboarding
- community acknowledgement
- vault password creation
- vault unlock

Root/auth shells should not learn app-specific destinations. They should preserve opaque invite state, and the unlocked app handler should resolve the action.

Existing direct behavior must stay unchanged when the user selects an existing peer with the required chat or wallet key.

## Write Boundary

Shared link contract:

- `shared/invite.js`
- `shared/links.js`
- `apps/web/src/app/page.js`
- `apps/web/src/app/rootclient.js`
- `guidelines/navigation.md`

Web invite surfaces:

- `apps/web/src/components/peerselector.js`
- `apps/web/src/components/dialogs/newchat.js`
- `apps/web/src/components/dialogs/share.js`
- `apps/web/src/components/sendmoney.js`
- `apps/web/src/components/requestmoney.js`
- `apps/web/src/components/dialogs/sendphoto.js`
- `apps/web/src/components/dialogs/sharemedia.js`

iOS invite surfaces:

- `apps/ios/src/components/peerpicker.js`
- `apps/ios/app/(vault)/(app)/peerselector.js`
- `apps/ios/app/(vault)/(app)/transfer.js`
- `apps/ios/app/(vault)/(app)/sendphoto.js`
- `apps/ios/app/(vault)/(app)/sharemedia.js`

Accept/resume paths:

- root web app-link metadata and client handoff
- iOS root app-link handling
- existing post-unlock chat/payment/share routes

## Plan

1. Add `shared/invite.js` with builder/parser/copy helpers.
2. Add root-page metadata for contextual paste previews.
3. Preserve invite state through auth, onboarding, vault creation, and unlock.
4. Resolve preserved invite state inside the unlocked app boundary.
5. Add invite affordances to peer-selection empty states and action footers.
6. Add faucet-demo copy and flow without presenting it as a signup reward.
7. Add fixtures for build, parse, mobile fallback, unauthenticated resume, locked resume, and post-onboarding resume.

## Acceptance Criteria

- Invite links are not parsed as QR payloads.
- A logged-out recipient opening a chat invite sees who invited them and what action will resume.
- A logged-out recipient opening a payment request sees the requester, amount, and Veyl payment CTA before account creation.
- A logged-out recipient can create an account, create a vault, unlock, and resume the original invite action.
- A locked existing user can unlock and resume the invite action.
- A logged-in unlocked user opening an invite lands directly in the appropriate chat/payment/media flow.
- Peer-selection empty states expose invite copy/share actions.
- Invite links never contain private message text, media bytes, wallet secrets, Firebase UIDs, Spark ids, encrypted payloads, or local cache keys.
