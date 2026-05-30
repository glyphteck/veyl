# Apple App Review - veyl

This document is for the Apple App Review team. It explains what veyl is, how to review the app, how to find the deterministic review bot, and where the safety, privacy, and support controls live.

## Review Environment

- App name: veyl
- Operator: Glyphteck Corp
- iOS app: veyl
- Web app for review: `links.veylTest`
- Public review page: `links.review`
- Support and safety contact: `links.contact`
- Dedicated review bot: `@review`
- Optional live support username: `@zxrl`

veyl uses passkeys instead of passwords. There is no reusable username/password demo credential because a passkey is bound to the reviewer device. To review the full product, create a new account in the app when prompted for a device passkey, then message `@review`. Reviewers may also message `@zxrl` for live help if that account is online, but the review flow does not depend on a human response.

## What veyl Does

veyl is a non-custodial Bitcoin and encrypted chat app. The core product flow is:

1. Create or sign into a company-wide Glyphteck account with a passkey.
2. Choose a public username.
3. Create a local vault password.
4. Unlock a locally encrypted vault.
5. Use the same local seed to derive a Spark wallet identity and an encrypted chat identity.
6. Send Bitcoin and communicate over encrypted one-to-one chat.

The review environment is `domains.veylTest`. It is intended for App Review and product testing.

## Feature List

- Passkey-first account creation and sign-in.
- Public usernames and optional avatars.
- Local vault password creation and unlock.
- Non-custodial Spark wallet boot from locally derived key material.
- Wallet balance display.
- Bitcoin receive/funding address display.
- Bitcoin send flow to another veyl user.
- On-chain withdrawal flow.
- Transfer history.
- End-to-end encrypted one-to-one chat.
- Text messages.
- Payment request messages in chat.
- Search for people by username.
- Deterministic review bot for testing chat and payments.
- Block controls.
- Report controls.
- Account deletion.
- Legal, privacy, support, and community-rules screens in the iOS app.
- Public legal and review pages on the web app.
- Admin moderation surfaces for reports, bot status, bot power, and chat bans.

## Suggested Review Flow

### 1. Create a Review Account

1. Open veyl on iOS.
2. Tap `new account`.
3. Create a passkey when prompted by iOS.
4. Pick a username.
5. Complete onboarding.
6. Create a vault password.
7. Unlock the vault.

The web app can also be used at `links.veylTest`, but the iOS app is the primary submission surface.

### 2. Find the Review Bot

1. Open the new-chat or search flow.
2. Search for `@review`.
3. Open the `@review` profile or chat.

`@review` is a normal veyl account operated by Glyphteck Corp. It has the bot marker in its public profile and is powered on for review.

### 3. Test Encrypted Chat

1. Send a text message to `@review`.
2. The bot replies by mirroring the message back.
3. The chat should remain available in the chat list.

### 4. Test Sending Bitcoin

1. Open the chat with `@review`.
2. Use the send/payment action.
3. Enter a small amount.
4. Confirm the send.
5. The transaction should appear in the chat and transaction history.

### 5. Test Payment Requests

1. Open the chat with `@review`.
2. Create a small payment request.
3. The bot pays the request if it has enough review funds.
4. The bot then sends a mirrored request for the same amount.

If the bot is temporarily underfunded, it replies with an underfunded message. Contact `links.contact` and include `@review` in the message.

### 6. Test Blocking

1. Open a user profile or chat details screen.
2. Use the block action.
3. Confirm the block.
4. The blocked account can no longer message the reviewer account, and blocked accounts are filtered from relevant user surfaces.

Blocked users can be managed from Settings.

### 7. Test Reporting

1. Open a user profile or message action menu.
2. Use the report action.
3. Submit the report, optionally with a note.

Reports are written to the backend moderation collection for manual review by Glyphteck Corp. Because chat is end-to-end encrypted, reported message content or evidence intentionally submitted by the reporter is used for abuse review.

### 8. Test Account Deletion

1. Open Settings.
2. Select delete account.
3. Confirm deletion.

Account deletion removes service-side account records controlled by Glyphteck Corp, including profile data, encrypted seed records, passkey records, usernames, chats, and chat media where applicable. Blockchain activity that has already been broadcast cannot be deleted by Glyphteck Corp.

## Safety and Moderation

veyl includes user-generated one-to-one text and payment-request content. The app includes:

- current community-rules acknowledgement during iOS and web onboarding,
- acceptable-use, privacy, terms, and support disclosures,
- user reporting,
- user blocking,
- admin report review,
- account, chat, username, upload, discovery, and bot restriction controls,
- support contact information,
- account deletion.

Current chat payloads include text, payment requests, and encrypted attachments where exposed by the client. Reports and blocks are available from profile, chat, and message surfaces where applicable. Blocked accounts are filtered from relevant people surfaces and cannot continue normal chat contact with the blocking account.

Public profile surfaces use reserved and banned username filtering during onboarding and lookup. Avatar restrictions are enforced through Storage rules, web admin moderation, the admin command path, and iOS avatar upload UI so an avatar ban prevents further avatar changes while it is active.

## Legal and Product Posture

veyl is not a bank, custodian, exchange, broker, escrow service, payment processor, or recovery service.

Glyphteck Corp does not have the user's vault password, decrypted seed, private keys, or plaintext encrypted chat messages during normal operation. Users are responsible for safeguarding their passkey access, vault password, device, wallet actions, counterparties, and legal compliance.

Bitcoin and blockchain transfers are irreversible. Glyphteck Corp cannot cancel, reverse, modify, or recover a completed transfer.

The app provides wallet functionality from Glyphteck Corp as an organization-owned developer account. It does not mine cryptocurrency, does not operate as an exchange, does not offer ICOs, futures, securities, or quasi-securities trading, and does not reward users with cryptocurrency for tasks such as downloading apps, posting to social networks, or inviting users.

## Backend and Infrastructure

veyl uses:

- Firebase Auth for account identity.
- Firebase Functions for passkey registration/login, onboarding writes, reports, settings, push token registration, and account deletion.
- Firestore for user records, profiles, encrypted seed blobs, chat metadata, encrypted messages, usernames, passkey records, bot control records, and reports.
- Firebase Storage for avatars and report/chat media where applicable.
- Google Secret Manager for bot seed material.
- Spark for Bitcoin wallet functionality.
- Apple passkeys and iOS platform security for passkey-backed access.

## Admin Tools

Glyphteck Corp operates internal admin tools for:

- report review,
- chat bans,
- bot listing and detail inspection,
- bot power control,
- bot runtime status,
- bot wallet/chat identity inspection for operational debugging,
- deleting or disabling bot accounts.

The review bot was provisioned with:

```bash
bun bot add @review
```

The bot can be powered with:

```bash
bun bot power @review on
bun bot power @review off
```

The local bot runtime is started with:

```bash
bun dev bot
```

## Community Rules Gate

Apple's current App Review Guidelines require full reviewer access for account-based features, live backend services during review, and user-generated-content controls such as filtering, reporting, blocking, and published contact information. For veyl, public user-generated surfaces are limited to usernames and profile avatars. Private one-to-one chat content is end-to-end encrypted and is not publicly posted.

Current decision: iOS and web both require acknowledgement of the latest community rules before vault/app access. If Glyphteck Corp ships updated rules, returning users are routed to the acknowledgement screen on their next app load or web session before they can continue into the app.

## App Review Guideline Mapping

- Full access and live services: reviewers can create a fresh passkey account, use the live review backend, use the web app at `links.veylTest`, and message `@review`.
- User-generated content: veyl filters public profile and discovery surfaces through strict username validation, avatar upload constraints, report controls, block controls, support contact information, manual report review, and administrative restrictions.
- Private encrypted chat: veyl does not inspect plaintext private messages before delivery. Any user can report a harmful message from a one-to-one chat and can choose to share that message content or related evidence with Glyphteck Corp for admin review. Abuse controls for private chat are report, block, delete, chat restriction, account restriction, and admin action.
- Privacy: the iOS and web legal pages disclose collected service data, unavailable secrets, retention, deletion, reports, and support contact.
- Account deletion: reviewers can delete an account from Settings.
- Cryptocurrency: veyl is a non-custodial wallet and direct user-to-user payment app. It is not an exchange, mining product, ICO, investment, task-reward, or paid digital-content unlock system.
