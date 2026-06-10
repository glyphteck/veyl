# Veyl Organic Launch Roadmap

## Launch hook

Primary line:

> I built private chat with Bitcoin payments built in.

Simpler variants:

- Send sats inside private chat.
- Private chat. Real Bitcoin.
- Bitcoin payments inside encrypted chat.
- A Bitcoin wallet where payment requests live in the conversation.

Best default for broad attention:

> Send sats inside private chat.

Use the longer version when talking to technical Bitcoin/privacy people:

> I built private chat with Bitcoin payments built in.

## Product positioning

Veyl should not launch as a generic private messenger or generic wallet.

Launch it as:

> A self-custodial Bitcoin wallet where payment requests, files, and private 1:1 messages live in the same encrypted thread.

Core promise:

- private 1:1 chat
- payment requests inside the thread
- self-custodial Bitcoin wallet
- passkey account
- local vault
- no phone number positioning
- open-source credibility

Avoid leading with:

- social network
- anonymous finance
- free money
- secure messenger
- crypto super-app

## Current repo read

Current landing page headline:

> own your money. chat privately.

Current landing page framing:

- safety first
- private communication
- fast and free payments
- security and privacy
- mobile users go to `/download`
- desktop users go to `/login`

Current QR state:

- QR primitives already support user links, payment-request links, and Bitcoin address links.
- Veyl QR links are already emitted as `/qr?...` wrapper URLs.
- Authenticated `/qr` already handles:
  - user QR -> find user and open chat
  - request QR -> open/send payment flow
  - Bitcoin QR -> open withdrawal flow
- Missing launch-grade behavior:
  - unauthenticated users lose the invite/payment context
  - `/download` is only a static placeholder
  - payment request links do not yet render a public landing page
  - invite buttons are not consistently available from every peer-selection surface

## Public payment-request landing page

Build every Veyl payment request link as a shareable landing page.

Example:

> @zak requested 2,500 sats on Veyl

Primary actions:

- Pay with Veyl
- Create Veyl account
- Open in app
- Open in existing Bitcoin wallet, where possible
- Copy request details

Landing page should show:

- requester username
- amount
- optional note/message
- Veyl explanation in one line
- app/open/signup CTA
- existing-wallet fallback if the request can be represented externally
- clear warning that Bitcoin payments are irreversible

The point is not only payment completion. The page itself is marketing:
someone receives a request, understands the product, and can decide to create an account.

## QR/invite loop

Make QR codes fully fledged invites.

Expected behavior:

1. Existing unlocked user opens `/qr?...`.
2. App resolves the QR immediately.
3. Existing locked user opens `/qr?...`.
4. App preserves the invite, sends user through unlock, then resumes.
5. New user opens `/qr?...`.
6. Site shows contextual landing page.
7. User creates account.
8. User creates vault.
9. App resumes the original intended action.

Supported invite types:

- user invite: `@zak on Veyl`
- chat invite: `message @zak privately`
- payment request: `@zak requested 2,500 sats`
- payment destination: `send sats to @zak`
- Bitcoin address fallback: standard `bitcoin:` URI

Add invite buttons everywhere there is peer selection:

- new chat
- send money
- request money
- payment dialog
- peer profile
- user QR/profile QR
- camera/media recipient selection
- empty chat states
- bot/review/faucet onboarding surfaces

Button copy:

- Invite
- Share invite
- Copy Veyl link
- Show QR

Use native share sheets on iOS and clipboard/share APIs on web.

## Faucet bot

Do not reward account creation.

Use a faucet bot as demo fuel.

Bot identity:

- `@faucet`
- clearly marked as a bot
- described as limited demo liquidity, not a signup reward

Behavior:

- user messages `@faucet`
- user creates a tiny payment request
- bot pays it if funded and within global cap
- bot explains when the faucet is empty
- bot can redirect to regtest/test demo when mainnet budget is empty

Hard caps:

- max request amount
- daily global budget
- weekly global budget
- per-chat cooldown if wanted, but do not depend on it for Sybil resistance
- global refill script or scheduled refill
- admin kill switch

Important:

- Assume it is farmable.
- Do not add invasive Sybil controls.
- Do not require one-account-per-person.
- Do not market it as “free sats for signing up.”
- Market it as “try the payment request flow.”

Suggested copy:

> Try Veyl with @faucet. Send a tiny payment request and see private chat + Bitcoin settlement in one flow. Limited demo budget.

## Open-source credibility kit

Before broad public launch, convert internal architecture docs into public trust docs.

Required files/pages:

- clean README for non-contributors
- architecture diagram
- threat model
- “what Glyphteck sees” table
- “what Glyphteck cannot recover” table
- SECURITY.md
- public roadmap
- known limitations
- “not audited yet” statement, if true
- easy local dev steps
- small good-first-issues

Trust docs should be blunt.

Example table:

| Surface | Glyphteck can see | Glyphteck should not see |
| --- | --- | --- |
| Account | uid, username, public keys, profile metadata | vault password |
| Chat | opaque chat/message records, timestamps, TTL metadata | plaintext messages |
| Wallet | public wallet identity, service metadata | seed/private keys |
| Reports | submitted report content/evidence | unreported private chat plaintext |
| Local cache | nothing unless uploaded | decrypted local cache |

## Landing page rewrite

Current headline is clean, but not specific enough for launch.

Replace or test:

> Send sats inside private chat.

Subheadline:

> Veyl combines a self-custodial Bitcoin wallet with end-to-end encrypted 1:1 messaging, so payment requests and conversations stay in one private flow.

CTA options:

Desktop:

- Try Veyl
- Create account
- Message @faucet
- Try payment request demo

Mobile:

- Open in app
- Download for iOS
- Continue on web

Feature cards:

1. Private chat with payments
2. Self-custodial Bitcoin wallet
3. Local vault, open-source design

Avoid saying “anonymous accounts” too strongly. Prefer:

- pseudonymous accounts
- no phone number
- passkey + local vault
- privacy-first identity

## 30-day launch plan

### Phase 0 — Prelaunch cleanup

Goal: make the product understandable without founder explanation.

Ship:

- landing page rewrite
- QR invite todo implementation
- payment request landing page
- `/download` real app/browser CTA
- faucet bot plan or MVP
- public trust docs
- README rewrite
- known limitations page
- @review and @faucet onboarding paths

### Phase 1 — Private alpha

Goal: get 20 high-signal people through the full loop.

Target users:

- Bitcoin builders
- nostr users
- privacy/security people
- freelancers who accept sats
- open-source contributors

Ask them to complete:

1. create account
2. create vault
3. message `@review` or `@faucet`
4. send message
5. create payment request
6. receive/pay tiny amount
7. share one invite link with another person

Track:

- account created
- vault created
- unlocked
- first chat opened
- first message sent
- first request created
- first payment completed
- invite link opened
- invite link converted
- where users quit

### Phase 2 — Pair onboarding

Goal: create real two-person usage, not isolated signups.

Tactics:

- invite button in all peer selectors
- pair-based founder outreach
- “try it with one person you already send sats to”
- Bitcoin meetup QR demos
- direct founder help for first 50-100 users

CTA:

> Try Veyl with someone you already send sats to.

### Phase 3 — Public technical launch

Goal: credibility + early community.

Post angles:

- “I built private chat with Bitcoin payments built in.”
- “Veyl is open source: passkeys, local vault, Spark wallet, encrypted chat.”
- “Why account rewards break anonymous apps.”
- “What Veyl’s server can and cannot see.”
- “Payment requests should live in the conversation.”

Channels:

- GitHub release
- X
- nostr
- Hacker News / Show HN
- Bitcoin dev communities
- privacy/security communities
- founder demo video

Primary ask:

> Try the @faucet or @review flow and tell me where you got stuck.

## Success metrics

Activation:

- account created
- vault created
- vault unlocked
- first chat opened
- first message sent
- first payment request created
- first payment settled

Invite loop:

- invite links created
- invite links opened
- unauthenticated invite opens
- signup from invite
- completed payment from invite
- completed chat from invite

Retention:

- users with 2+ chats
- users with 2+ payments
- users who return after 7 days
- users who invite another user

Trust:

- GitHub stars
- issues opened
- external reviews
- security feedback
- README-to-signup conversion

## Do not do

- fake users
- per-account sat rewards
- phone/KYC/device checks for rewards
- generic “secure messenger” launch
- “anonymous finance” marketing
- broad influencer crypto marketing
- fake social proof
- claims of audit/security maturity that are not true

## Immediate build order

1. Payment request landing page.
2. Preserve QR invite context through auth/onboarding/unlock.
3. Add Invite button to all peer selection surfaces.
4. Add `@faucet` hard-capped demo bot.
5. Rewrite landing hero around “Send sats inside private chat.”
6. Publish README/trust docs.
7. Run 20-person private alpha.
8. Launch publicly with the technical/open-source angle.
