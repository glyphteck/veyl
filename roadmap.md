# Veyl Roadmap

## Account And Wallet Architecture

### Imported Wallet Account Creation

- Support account creation from an imported wallet.
- Prove that imported wallet material can become or derive from the same long-term master seed source of truth as normal account creation.
- If that is not feasible, redesign account creation before launch-sensitive wallet assumptions harden.
- Wallet imports are mandatory; do not ship an account model that permanently blocks them.

### Multi-Wallet Accounts

- Evaluate deriving many wallet seeds from one master seed.
- Design a simple wallet switch button UX.
- Decide how default wallet selection, payment requests, transaction history, and wallet-specific balances should work.
- Decide what stays shared across wallets versus wallet-specific.
- Wallet access must not break after launch, even if chat can later reset or migrate.

### Fast Account Switch And Multi-Identity

- Review fast account switching in auth and app context.
- Decide whether multi Firebase auth is viable.
- Decide whether lock state should be device-based or account-based.
- Evaluate separate provider trees per identity for peers, vault, chat, wallet, and user state.
- Compare that with a model where multiple identities sit under one passkey auth and vault auth root.
- Decide whether a single uid can safely hold multiple usernames, profiles, wallets, and identities.

## Future Crypto Direction

- Evaluate stronger e2ee such as double ratchet without breaking long-term account access.
- Keep cross-device sync as a hard requirement.
- Accept that chat may need a future reset or migration, but wallet access cannot break after launch.
- Map which crypto upgrades require device-local state and whether that conflicts with sync.
- Review whether wallet rotation, chat rotation, and anonymity upgrades can share a generalized rotation seed model.

## Wallet Expansion

### USD And Multi-Currency

- Support holding multiple currencies inside the wallet.
- Prioritize USDB or a USD-denominated wallet surface, but design a currency model that can later support other tokens or digital fiat.
- Redesign wallet dashboards so BTC and USDB/USD balances can be shown separately and as one total.
- Replace the low-value web dashboard `net` section with per-currency balances.
- Add an iOS currencies section before the transaction list.
- Make send and request flows currency-aware.
- Add currency fields to transactions and update transaction UI accordingly.
- Use BTC and USDB/USD icons to label balances and transactions.
- Decide whether to expose `USDB` directly or abstract it as `USD`.
- Revisit BTC price polling cadence; target at least 1-minute polling if price display remains important.
- Decide whether USDB/USD should become the display source of truth for fiat value.

### On-Ramping

- Research on-ramping into the app from Apple Pay or common payment methods.
- Keep non-custodial posture explicit if adding any fiat or payment-provider integration.

### Wallet Privacy

- Explore wallet rotation so only the current walletPK is shared with a sender, then switch wallet per transaction.
- Consider a broader rotation abstraction that can later apply to chat identity too.
- Explore custom QR codes and private-wallet flows.

## Chat And Media

- Tap to fullscreen for photo and mp4 messages.
- Add playback-speed controls where useful, especially for audio.
- Revisit the current attachment size limit and define realistic audio/video length expectations for mobile capture and upload.
- Rebuild iOS keyboard handling for richer media and chat flows.

## Backend Evolution

- Add an abstraction layer so apps and providers do not need to talk to backend implementation details directly.
- Audit backend cost at `10^1` through `10^6` daily users.
- Use conservative, neutral, and excessive usage models for each user plateau.
- Move bot operation from local/manual runtime management to dedicated hosted infrastructure.
- Compare Firebase, AWS, and low-cost self-hosted options for bot scale.
- Keep dormant architecture and privacy research ideas in [ideas.md](ideas.md) instead of treating them as active roadmap commitments.

## Moderation And Public Accountability

- Consider making reports public on user profiles.
- Show report count on public user profiles.
- Let users click a report count to see reported content sent by that user when the reporter chose to make evidence public.
- Explore vote-based public bans.
- Weigh accountability benefits against harassment, brigading, false-report, and privacy risks before implementation.

## Admin Encryption

- Add an admin key model for decrypting reports and other admin-accessible encrypted content.
- Keep admin-readable content intentionally scoped and separate from normal private chat content.

## Company Structure And Ops

- Decide whether to keep the Canadian corp as-is, move operating structure to another country, or create a shell under the Canadian corp.
- Review legal and tax exposure if the Canadian corp is dormant, active, or paying the owner while the owner lives abroad.
- Review whether personal financial tooling that still uses a Canadian address creates extra risk.
- Update Canadian corporate address and files without switching province unless there is a deliberate legal decision to do so.
- Send the required corporate paper before June.
- Evaluate whether closing the Canadian corp and reopening elsewhere is worth it given current zero-cost status.

## Brand And UX Backlog

- Revisit logo and name before public launch if needed.
- Add conditional copy for Face ID, Touch ID, or device password on iOS instead of a generic label.
- Decide what profiles should become long term now that Settings owns the old profile header.
