# Apple Review Guidelines

This is a Veyl-facing reference for Apple's App Review posture. It is not a copy of the full guideline text and it is not legal advice.

Checked: 2026-05-17

Primary sources:

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Account deletion guidance: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- February 6, 2026 guideline update on random or anonymous chat: https://developer.apple.com/news/?id=d75yllv4

Apple's guidelines are a living document. Before a real submission or a product change near review-sensitive areas, recheck the official source.

## Veyl Review Posture

Veyl should be presented as:

- an organization-submitted app by Glyphteck Corp;
- a passkey account app using Glyphteck's own account system;
- a non-custodial Bitcoin wallet and encrypted 1:1 chat app;
- not a bank, exchange, broker, escrow, investment, mining, ICO, task-reward, gambling, or paid digital-content unlock system;
- not a random or anonymous chat app.

The reviewer-facing explanation lives in `review.md` and the public web review page. Keep those surfaces aligned when reviewer access, moderation, privacy, legal, crypto, or bot behavior changes.

## Before Submission

Apple asks developers to reduce review friction by doing the basics before submitting. For Veyl, confirm:

- the build has been tested on a physical device for crashes and obvious broken flows;
- App Store metadata, screenshots, privacy labels, support URL, and privacy policy URL are complete and accurate;
- backend services needed for review are live and reachable;
- reviewer access is fully explained in App Review notes;
- the review flow works without shared username/password credentials by letting reviewers create a passkey account;
- `@review` is powered, reachable, and funded enough for the intended chat/payment checks;
- non-obvious features are explained, especially passkeys, vault unlock, non-custodial wallet posture, encrypted chat, payment requests, and the review bot;
- all URLs in metadata and review notes work.

## Guideline 1: Safety

### 1.2 User-Generated Content

Veyl has user-generated content through usernames, avatars, 1:1 messages, payment requests, and attachments. Maintain:

- filtering or restriction paths for public profile/discovery material;
- report controls for users, messages, profiles, and abusive behavior;
- timely review path for reports;
- block controls;
- published support/contact information;
- admin controls for account, username, avatar/upload, chat, discovery, bot, and report handling.

Apple clarified on 2026-02-06 that random or anonymous chat apps are subject to Guideline 1.2. Veyl should avoid copy, metadata, screenshots, or product flows that make it look like random matching, anonymous chat, public chat roulette, or unmoderated social posting.

If adding group chat, public posts, public media, public comments, creator content, recommendations, random matching, anonymous rooms, or discovery feeds, revisit Guideline 1.2 before implementation.

### 1.5 Developer Information

The app and support URL must make it easy to contact Glyphteck. Keep `links.contact`, in-app legal/support screens, App Store support URL, and public legal/review pages current.

### 1.6 Data Security

Veyl's core claims depend on security posture. Do not weaken:

- local-only vault password handling;
- encrypted seed storage;
- encrypted chat payloads;
- vaulted local cache boundaries;
- backend rules around profiles, seeds, chats, reports, uploads, and account deletion.

## Guideline 2: Performance

### 2.1 App Completeness

Submit only final, working builds. Avoid placeholder copy, dead links, demo-only surfaces, broken backend states, or empty metadata. Account-based features require full reviewer access or an approved fully featured demo mode.

For Veyl, the clean review path is:

1. reviewer creates a passkey account;
2. reviewer chooses username/avatar as desired;
3. reviewer creates and unlocks the vault;
4. reviewer searches `@review`;
5. reviewer tests chat, payment request, send, block, report, and account deletion.

### 2.3 Accurate Metadata

Metadata must match the app. For Veyl:

- do not imply exchange, investing, custody, returns, interest, brokerage, escrow, or recovery services;
- do not market chat as random, anonymous, public, or unmoderated;
- screenshots should show the app in use, not only splash/login;
- age rating answers must be honest about chat, user-generated content, attachments, crypto/wallet functionality, and any web access;
- Review Notes should describe meaningful product changes specifically, not with generic "updates" wording.

### 2.4 and 2.5 Technical Expectations

Relevant recurring checks:

- no on-device cryptocurrency mining or unrelated background processing;
- app should be efficient enough not to drain battery, overheat, or strain device resources;
- use public APIs and current supported OS/toolchain expectations;
- app should work on IPv6-only networks;
- camera, photos, Face ID, push, and file permissions need clear purpose strings and must map to real features;
- recording, camera, microphone, or screen capture behavior must be obvious and consent-based;
- push notifications should be related to app functionality.

## Guideline 3: Business

### 3.1 In-App Purchase

Veyl should avoid paid digital content, paid feature unlocks, boosts, subscriptions, or creator monetization unless the App Store payment model is deliberately designed first.

Direct Bitcoin transfers between users must not become a mechanism to unlock app-hosted digital goods or services in a way that would look like bypassing in-app purchase.

### 3.1.5 Cryptocurrencies

Apple allows wallet apps to facilitate virtual currency storage when submitted by an organization. Veyl's current posture depends on:

- Glyphteck Corp organization developer enrollment;
- wallet functionality framed as non-custodial storage and direct user payments;
- no mining on device;
- no exchange, brokerage, derivatives, futures, securities, ICO, staking/investment-return, or quasi-securities functionality unless legal/licensing posture changes first;
- no crypto rewards for tasks such as downloading apps, inviting users, or posting on social networks.

If Veyl adds swaps, order books, hosted liquidity, exchange routing, fiat on/off ramp, yield, token sales, derivatives, task rewards, or promoted paid content tied to payments, revisit 3.1.5 and legal posture first.

### 3.2 Financial/Business Risks

Apps used for financial trading, investing, or money management get higher scrutiny. Keep Veyl's copy narrow: wallet, direct payment, encrypted chat. Do not describe it as investment advice, money management, exchange service, banking, or escrow.

## Guideline 4: Design

### 4.8 Login Services

Veyl uses its own Glyphteck passkey account system. Apple's third-party/social-login equivalent-login requirement should not apply while Veyl exclusively uses its own account setup and sign-in system.

If Veyl adds Google, Facebook, X, LinkedIn, Amazon, WeChat, or similar third-party/social login, revisit 4.8 before shipping.

### 4.5.4 Push Notifications

Push notifications:

- must not be required for core app use;
- should not contain sensitive or confidential content;
- should not be used for marketing unless the user explicitly opts in and can opt out;
- should stay tied to Veyl functionality, such as new-message awareness.

### 4.10 Built-In Capabilities

Do not monetize access to push notifications, camera, gyroscope, iCloud storage, Screen Time APIs, or other built-in OS/hardware capabilities.

## Guideline 5: Legal And Privacy

### 5.1.1 Privacy Policy, Consent, Data Minimization, Account Deletion

Veyl must keep a privacy policy link in App Store Connect metadata and inside the app. The policy should explain:

- what data Veyl collects;
- how data is collected and used;
- which third parties receive data, if any;
- retention and deletion behavior;
- how users can revoke consent or request deletion.

Request only data needed for the feature. Prefer pickers/share sheets and narrow permissions over broad data access. Do not force users into unnecessary permissions.

Because Veyl supports account creation, it must support account deletion inside the app. Apple's account deletion guidance expects:

- deletion option easy to find, usually in account/settings;
- full account deletion, not only deactivation;
- clear confirmation and explanation if deletion takes time;
- no unnecessary support-only deletion flow;
- user-generated content associated with the account deleted unless retention is legally required;
- all users can delete accounts, regardless of location.

For Veyl, deletion copy should continue warning about irreversible blockchain activity, withdraw/export paths, and what Glyphteck can and cannot delete.

### 5.1.1(ix) Legal Entity For Regulated Fields

Apps in highly regulated fields, including banking, financial services, crypto exchanges, or apps requiring sensitive user information, should be submitted by the legal entity providing the services. Keep Veyl under Glyphteck Corp and do not move wallet submission to an individual account.

### 5.1.2 Data Use And Sharing

Do not share personal data without permission. If tracking, advertising, analytics, third-party AI, or cross-app profiling is added, update privacy labels, legal copy, consent flows, and App Tracking Transparency posture before submission.

### 5.2 Intellectual Property

Only use assets, names, screenshots, logos, app icons, and metadata Glyphteck owns or is licensed to use. Do not imply Apple endorsement.

### 5.3 Gambling

Do not add betting, lotteries, gambling mechanics, or prize contests without a separate legal and guideline review.

## App Store Connect Checklist

Before a real submission, check:

- App name: `veyl`
- Bundle ID: `com.glyphteck.veyl`
- Developer: Glyphteck Corp
- Support URL: public support/contact route
- Privacy policy URL: public legal/privacy route
- Category: selected to match wallet/chat posture without overclaiming
- Age rating: answered honestly for chat, UGC, attachments, crypto, and any web access
- Screenshots: real app surfaces, no private real-user data
- Review notes: passkey account creation, no shared password, `@review`, optional `@zxrl`, backend environment, crypto posture, moderation controls
- Export compliance/encryption answers: reviewed against actual crypto use
- App Privacy labels: match current Firebase, Storage, push, profile, chat/report, wallet, and analytics posture

## Product Changes That Require Rechecking This File

Recheck official guidelines before adding:

- public posting, public comments, public media, feeds, creator content, group rooms, random chat, anonymous chat, or discovery ranking;
- swaps, exchange routing, fiat rails, yield, staking, securities-like products, derivatives, lending, escrow, custody, or token launches;
- in-app purchases, subscriptions, boosts, paid digital content, creator monetization, donations, ads, or task rewards;
- third-party/social login;
- tracking, ad SDKs, analytics expansion, third-party AI data sharing, or contact importing;
- location features, VPN/MDM/device-management behavior, health/fitness data, kids/minor-focused features, gambling, contests, or lotteries;
- mini apps, embedded chatbots/plugins, downloaded executable behavior, or web-like software catalogs.

