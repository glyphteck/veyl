# Navigation

Start here when a task touches one of these areas.

## Auth And Onboarding

- Web passkeys: `apps/veyl/web/src/lib/passkey.js`
- iOS passkeys: `apps/veyl/ios/src/lib/passkeys.js`
- Passkey functions: `functions/passkey/register.js`, `functions/passkey/login.js`
- Username onboarding: `functions/user/onboarding/setusername.js`
- Public key onboarding: `functions/user/onboarding/setpks.js`
- Web onboarding routes: `apps/veyl/web/src/app/(authenticated)/*`
- iOS onboarding routes: `apps/veyl/ios/app/(onboarding)/*`
- Root-domain auth files: separate Website repo under `public/.well-known/*`

## Vault And Seed Handling

- Shared vault boot helpers: `shared/vaultutils.js`
- Shared vaulted local cache helpers: `shared/localdatacache.js`
- Seed crypto: `shared/crypto/seed.js`
- Packed Firestore byte helpers: `shared/crypto/pack.js`
- Web vault provider: `apps/veyl/web/src/components/providers/vaultprovider.js`
- iOS vault provider: `apps/veyl/ios/src/providers/vaultprovider.js`
- Web local cache adapter: `apps/veyl/web/src/lib/localdatacache.js`
- iOS local cache adapter: `apps/veyl/ios/src/lib/localdatacache.js`
- Web wallet export: `apps/veyl/web/src/components/dialogs/exportwallet.js`
- iOS wallet export: `apps/veyl/ios/app/(vault)/(app)/exportwallet.js`

## Wallet

- Shared wallet provider factory: `shared/wallet.js`
- Web wallet provider wrapper: `apps/veyl/web/src/components/providers/walletprovider.js`
- iOS wallet provider wrapper: `apps/veyl/ios/src/providers/walletprovider.js`
- Shared tx aggregation: `shared/providers/txdataprovider.js`
- Web withdraw dialog: `apps/veyl/web/src/components/dialogs/withdraw.js`
- iOS withdraw route: `apps/veyl/ios/app/(vault)/(app)/withdraw.js`
- Account deletion flows: `apps/veyl/web/src/components/dialogs/deleteaccount.js`, `apps/veyl/ios/app/(vault)/(app)/deleteaccount.js`

## Chat

- Shared chat provider factory: `shared/providers/chatprovider.js`
- Shared chat transport: `shared/chat/utils.js`
- Shared chat crypto: `shared/crypto/chat.js`
- Shared chat message and encrypted control-payload helpers: `shared/chat/messages.js`
- Shared chat outbound/local pending helpers: `shared/chat/send.js`
- Shared chat read-receipt helpers: `shared/chat/read.js`
- Shared chat list/cache state helpers: `shared/chat/chats.js`
- Shared chat attachment/cache helpers: `shared/chat/attachments.js`
- Web chat provider: `apps/veyl/web/src/components/providers/chatprovider.js`
- iOS chat provider: `apps/veyl/ios/src/providers/chatprovider.js`
- iOS full-screen media viewer: `apps/veyl/ios/src/providers/mediaviewerprovider.js`
- iOS full-screen media viewer UI: `apps/veyl/ios/src/components/media/mediaviewer.js`
- iOS long-press menu provider: `apps/veyl/ios/src/providers/menuprovider.js`
- iOS long-press menu portal UI: `apps/veyl/ios/src/components/menuportal.js`
- iOS transient media render-file cache: `apps/veyl/ios/src/lib/msgimagecache.js`

Keep `shared/providers/chatprovider.js` focused on React provider orchestration. It owns the chat-list listener, pending local state, and read receipts. Recent-chat warming lives in `shared/chat/warming.js`: it keeps provider-owned latest-message batches, prioritizes the first chat row, and warms image/video caches in the background after server-confirmed messages arrive. `shared/chat/usemessages.js` should consume those provider-owned batches as its initial visible list instead of attaching its own latest-message listener or carrying a separate route-built list cache, so opening a warmed chat does not double-subscribe or restart from an empty list. Media rows may reuse in-memory render-file URIs, and video rows should render cached poster images instead of mounting live video elements just because a row appeared. Put outbound message shaping, optimistic local send state, and retry payload helpers in `shared/chat/send.js`; put read-receipt scheduling and derivation in `shared/chat/read.js`. Chat media is still evolving. Before changing payload shape, inspect both clients and shared chat code.

## Bots

- Bot runtime: `apps/veyl/bot/src/runtime.js`
- Bot entry point: `apps/veyl/bot/src/index.js`
- Bot provisioning: `apps/veyl/bot/src/newbot.js`
- Bot secrets: `apps/veyl/bot/src/secrets.js`
- Shared bot modules: `shared/bot/*`
- Full bot doc: `bots.md`

## People And Profiles

- Shared user provider: `shared/providers/userprovider.js`
- Shared peer provider: `shared/providers/peerprovider.js`
- Shared lookup/cache layer: `shared/peers.js`
- Web wrapper: `apps/veyl/web/src/lib/peers.js`
- iOS wrapper: `apps/veyl/ios/src/lib/peers.js`

`usePeer()` exposes `recentPeers.all`, `recentPeers.wallet`, and `recentPeers.chat`. Use those lists for default recent-person pickers instead of locally sorting every cached peer; keep explicit profile search broad unless the surface requires a feature-specific key such as wallet or chat.

## Search

The search system is built around profile lookups. An input string is parsed into a typed query (`username`, `role`, `key`), routed through a source to a Firestore fetch, then merged with locally cached people. Adding a new role is a single entry in `roles.js`.

- Generic React hook factory: `shared/search/hook.js`
- Profile source: `shared/search/source.js`
- Firestore profile queries: `shared/search/remote.js`
- Roles registry: `shared/search/roles.js`
- Input parser: `shared/search/query.js`
- Local profile predicate: `shared/search/predicate.js`
- Result sort: `shared/search/sort.js`
- Local + remote merge: `shared/search/merge.js`
- Web search wrapper: `apps/veyl/web/src/lib/search/usesearch.js`
- iOS search wrapper: `apps/veyl/ios/src/lib/search/usesearch.js`

Conventions:

- `@` is the only profile-search prefix.
- Reserve `/` for future commands.
- `useSearch('mainmenu')` requires `@` to engage so cmdk keeps filtering on bare text.
- Everywhere else uses `useSearch('profiles')`, where bare text is a username and `@<role>` triggers a role lookup.
- The hook returns `query` as a parsed object `{ kind, value, role?, raw }` or `null`. Consumers should not parse the raw input themselves.

## Backend And Rules

- Firebase Functions entrypoint: `functions/index.js`
- Firestore security rules: `firestore.rules`
- Firebase Storage rules: `storage.rules`
- Web server-side auth gate: `apps/veyl/web/src/lib/firebase/firebaseadmin.js`
- veyl web shell files: `apps/veyl/web/src/*`
