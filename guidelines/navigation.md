# Navigation

Start here when a task touches one of these areas.

## Auth And Onboarding

- Web passkeys: `apps/web/src/lib/passkey.js`
- iOS passkeys: `apps/ios/src/lib/passkeys.js`
- Passkey functions: `functions/passkey/register.js`, `functions/passkey/login.js`
- Username onboarding: `functions/user/onboarding/setusername.js`
- Public key onboarding: `functions/user/onboarding/setpks.js`
- Web onboarding routes: `apps/web/src/app/(authenticated)/*`
- iOS onboarding routes: `apps/ios/app/(onboarding)/*`
- iOS stack options and route locks: `apps/ios/src/lib/navigation/*`
- Root-domain auth files: separate Website repo under `public/.well-known/*`

Forced auth, vault, and onboarding flows are route-guard owned. After a required write such as username, avatar, community acknowledgement, seed creation, auth, or unlock state changes, update the underlying state and let the guarded layout or protected stack choose the next route. Do not push or replace to the next concrete forced step from the completing screen; reserve explicit navigation for optional user actions and non-forced exits.

## Vault And Seed Handling

- Shared vault boot helpers: `shared/vault.js`
- Shared vaulted local cache helpers: `shared/cache/localdata.js`
- Seed crypto: `shared/crypto/seed.js`
- Packed Firestore byte helpers: `shared/crypto/pack.js`
- Web vault provider: `apps/web/src/components/providers/vaultprovider.js`
- iOS vault provider: `apps/ios/src/providers/vaultprovider.js`
- Web local cache adapter: `apps/web/src/lib/cache/localdata.js`
- iOS local cache adapter: `apps/ios/src/lib/cache/localdata.js`
- Web wallet export: `apps/web/src/components/dialogs/exportwallet.js`
- iOS wallet export: `apps/ios/app/(vault)/(app)/exportwallet.js`

## Wallet

- Shared wallet provider factory: `shared/wallet/provider.js`
- Shared wallet primitives: `shared/wallet/fees.js`, `shared/wallet/keys.js`, `shared/wallet/spark.js`
- Web wallet provider wrapper: `apps/web/src/components/providers/walletprovider.js`
- iOS wallet provider wrapper: `apps/ios/src/providers/walletprovider.js`
- Shared Bitcoin provider factory: `shared/providers/bitcoinprovider.js`
- Web Bitcoin provider wrapper: `apps/web/src/components/providers/bitcoinprovider.js`
- iOS Bitcoin provider wrapper: `apps/ios/src/providers/bitcoinprovider.js`
- Shared tx aggregation: `shared/providers/txdataprovider.js`
- Web withdraw dialog: `apps/web/src/components/dialogs/withdraw.js`
- iOS withdraw route: `apps/ios/app/(vault)/(app)/withdraw.js`
- Account deletion flows: `apps/web/src/components/dialogs/deleteaccount.js`, `apps/ios/app/(vault)/(app)/deleteaccount.js`

## QR And App Links

- Shared QR helpers: `shared/qr.js`
- Shared app-link domains and host URLs: `shared/links.js`, [links.md](../links.md)
- Web QR route: `apps/web/src/app/(authenticated)/(vault)/(app)/qr/page.js`
- iOS user scan route: `apps/ios/app/(vault)/(app)/userscan.js`
- iOS camera scanner: `apps/ios/app/(vault)/(app)/(home)/camera.js`

Veyl-specific QR codes are HTTPS wrappers at `/qr` on the active Veyl web host. Use `shared/qr.js` to write and read them. Do not emit raw `veyl:` strings or base64 JSON payloads.

Current QR structures:

- User: `${links.veyl}/qr?u=<username>`
- Payment request: `${links.veyl}/qr?r=<walletPK>&a=<sats>` (`a` is optional)
- Bitcoin funding address: `bitcoin:<address>`

For user QR codes, the username is the scanned account id. Do not encode Firebase UIDs in user QR codes.

The wrapper URL is intentional for Veyl-specific actions. On iOS, the Veyl web hosts are app links, so a system Camera scan opens Veyl when it is installed. Without the app, the website can send mobile users to the download page, and desktop users go through the normal web auth/unlock path. Bitcoin funding QR codes intentionally stay standard `bitcoin:` URIs so external wallets can scan them directly.

## Chat

- Shared chat provider factory: `shared/providers/chatprovider.js`
- Shared chat list transport: `shared/chat/list.js`
- Shared chat crypto: `shared/crypto/chat.js`
- Shared chat message and encrypted control-payload helpers: `shared/chat/messages.js`
- Shared chat message query helpers: `shared/chat/messages/query.js`
- Shared chat message write helpers: `shared/chat/messages/write.js`
- Shared chat action hooks: `shared/chat/actions/*`
- Shared chat read-receipt helpers: `shared/chat/read.js`
- Shared chat list/cache state helpers: `shared/chat/chats.js`
- Shared chat attachment/cache helpers: `shared/chat/attachments.js`
- Web chat provider: `apps/web/src/components/providers/chatprovider.js`
- iOS chat provider: `apps/ios/src/providers/chatprovider.js`
- Web chat UI helpers: `apps/web/src/lib/chat/messages.js`
- Web chat message/media runtime helpers: `apps/web/src/lib/chat/*`
- iOS chat UI helpers: `apps/ios/src/lib/chat/messages.js`
- iOS chat message hook wrapper: `apps/ios/src/lib/chat/usemessages.js`
- iOS full-screen media viewer: `apps/ios/src/providers/mediaviewerprovider.js`
- iOS full-screen media viewer UI: `apps/ios/src/components/media/mediaviewer.js`
- iOS long-press menu provider: `apps/ios/src/providers/menuprovider.js`
- iOS long-press menu portal UI: `apps/ios/src/components/menuportal.js`
- iOS transient media render-file cache: `apps/ios/src/lib/chat/imagecache.js`

Keep `shared/providers/chatprovider.js` focused on React provider orchestration. It owns chat-list wiring, pending local action state, read receipts, hidden checkpoints, and provider-level message session plumbing. Provider-owned current-message state lives in `shared/chat/messages/session/`: it keeps latest-message session entries, session-only remembered views, and recent-chat warming. `shared/chat/usemessages.js` should consume those provider-owned sessions as its initial visible list instead of attaching its own latest-message listener or carrying a separate route-built list cache, so opening a warmed chat does not double-subscribe or restart from an empty list. Warm sessions must not download attachment bytes; media rows may reuse in-memory render-file URIs, and video rows should render cached poster images instead of mounting live video elements just because a row appeared. Put outbound message shaping, optimistic local send state, retry payload helpers, reactions, save toggles, whole-chat deletion, seen/read action scheduling, and settings mutations in `shared/chat/actions/`; put encrypted read-receipt primitives in `shared/chat/read.js`; put action-log rendering, message TTL mutations, and removed source-doc handling in `shared/chat/messages/`. Chat media is still evolving. Before changing payload shape, inspect both clients, bot runtime, rules, and shared chat code.

## Bots

- Bot runtime: `apps/bot/src/runtime.js`
- Bot entry point: `apps/bot/src/index.js`
- Bot provisioning: `apps/bot/src/newbot.js`
- Bot secrets: `apps/bot/src/secrets.js`
- Shared bot modules: `shared/bot/*`
- Full bot doc: `bots.md`

## People And Profiles

- Shared user provider: `shared/providers/userprovider.js`
- Shared peer provider: `shared/providers/peerprovider.js`
- Shared lookup/cache layer: `shared/peers.js`
- Web wrapper: `apps/web/src/lib/peers.js`
- iOS wrapper: `apps/ios/src/lib/peers.js`

`usePeer()` exposes `recentPeers.all`, `recentPeers.wallet`, and `recentPeers.chat`. Use those lists for default recent-person pickers instead of locally sorting every cached peer; keep explicit profile search broad unless the surface requires a feature-specific key such as wallet or chat.

## Search

The search system is built around profile lookups. An input string is parsed into a typed query (`username`, `role`, `key`), routed through a source to a Firestore fetch, then merged with locally cached people. Adding a new role is a single entry in `roles.js`.

- Generic React hook factory: `shared/search/hook.js`
- Profile source: `shared/search/source.js`
- Firestore profile queries: `shared/search/remote.js`
- Roles registry: `shared/search/roles.js`
- Input parser: `shared/search/query.js`
- Local profile match: `shared/search/match.js`
- Result sort: `shared/search/sort.js`
- Local + remote merge: `shared/search/merge.js`
- Web search wrapper: `apps/web/src/lib/search/usesearch.js`
- iOS search wrapper: `apps/ios/src/lib/search/usesearch.js`

Conventions:

- `@` is the only profile-search prefix.
- Reserve `/` for slash commands.
- `useSearch('mainmenu')` requires `@` to engage so the in-house main menu keeps filtering local actions on bare text.
- Everywhere else uses `useSearch('profiles')`, where bare text is a username and `@<role>` triggers a role lookup.
- The hook returns `query` as a parsed object `{ kind, value, role?, raw }` or `null`. Consumers should not parse the raw input themselves.

## Backend And Rules

- Firebase Functions entrypoint: `functions/index.js`
- Firestore security rules: `firestore.rules`
- Firebase Storage rules: `storage.rules`
- Web client route gates: `apps/web/src/lib/routeguards.js`
- veyl web shell files: `apps/web/src/*`
