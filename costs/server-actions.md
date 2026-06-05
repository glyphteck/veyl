# Server actions source of truth

This is the repo-tied source of truth behind [action-costs.md](action-costs.md) and [README.md](README.md). The compact files are for reading and planning; this file keeps the full reasoning trail and code-path ownership.

The audit uses the operation notation from [basecosts.md](basecosts.md):

- `FR`: Firestore document read.
- `FW`: Firestore document write.
- `FD`: Firestore document delete.
- `RR`: Firestore Security Rules dependent read from a client SDK request.
- `FN`: Cloud Functions / Cloud Run functions invocation.
- `SA`: Cloud Storage Class A operation.
- `SB`: Cloud Storage Class B operation.
- `P`: receiver push device docs.
- `B`: blocked peer docs.
- `C`: user chats.
- `M`: messages in a chat.
- `N`: send targets.

Admin SDK reads and writes bypass Firestore and Storage Security Rules. Client SDK calls do not.

## Exported backend surfaces

`functions/index.js` exports the billable backend surfaces:

| Export | Type | Cost area |
| --- | --- | --- |
| `passkeyRegisterOptions` | callable | passkey account creation challenge |
| `passkeyRegisterVerify` | callable | passkey account creation verify/Auth/user doc |
| `passkeyLoginOptions` | callable | existing login challenge |
| `passkeyLoginVerify` | callable | existing login verify/Auth/passkey counter |
| `getBTCdata` | scheduled | global BTC price/fee data |
| `setUsername` | callable | username onboarding |
| `setWalletPK` | callable | wallet public key onboarding |
| `setChatPK` | callable | chat public key onboarding |
| `deleteAccount` | callable | account deletion |
| `setPush` | callable | push token registration |
| `dropPush` | callable | push token removal |
| `submitReport` | callable | user/message reporting |
| `reserveReportEvidenceUpload` | callable | report evidence upload reservation |
| `reserveChatMediaUpload` | callable | chat media signed upload and quota |
| `reserveSharedMediaUpload` | callable | shared media signed upload and quota |
| `setChatMessageTtl` | callable | saved/temporary message TTL and media hold toggle |
| `checkChats` | callable | batch deleted-chat status check for owner chat entries |
| `openChatLink` | callable | link-scoped active chat id creation/reuse |
| `push` | callable | block-enforced recipient inbox ping delivery and generic push |
| `deleteChat` | callable | rare opaque chat subtree delete, single or batch |
| `deleteChatMessage` | callable | hard delete one message and related media state |
| `deleteChatMessages` | callable | hard delete a batch of messages and related media state |
| `cleanupDeletedChats` | scheduled | chunked cleanup for chats tagged deleted |
| `setBotPower` | callable | admin bot enable/disable |

## Firestore and Storage rules cost model

Rules-dependent reads are easy to hide because they are not in app code. They still bill as Firestore reads for client SDK requests.

### Firestore rules

`firestore.rules` helper reads:

- `activeBan(uid, key)` checks `moderation/{uid}` with `exists()` and `get()`.
- `isChatBanned(uid)` checks `moderation/{uid}` with `exists()` and `get()`.

Planning estimates:

| Client operation | Expected rule reads |
| --- | ---: |
| Owner presence update on `profiles/{uid}.active` | 0 `RR` |
| Owner avatar update to non-null | about 1 `RR` on `moderation/{uid}` |
| Parent chat get/update | denied |
| Message get/list/create | about 1 `RR` on `chats/{chatId}` so deleted chats are denied server-side |
| Message update | denied |
| Message delete | no client rules path; hard deletes go through callables |
| Message save/unsave TTL toggle | no client rules path; `setChatMessageTtl` checks deleted chats in Functions |
| Owner chat entry writes | 0 extra `RR` |
| User settings/community/seed/block writes | 0 extra `RR` |

Rules can short-circuit and cache repeated dependent docs inside a request. Treat counts as planning estimates until measured against emulator/debug logs or billing export.

### Storage rules

`storage.rules` helper reads:

- Avatar write/delete by owner calls `isAvatarBanned(uid)`, which checks `moderation/{uid}`.
- Admin avatar delete checks `admins/{request.auth.uid}`.
- Chat media writes use signed upload URLs minted by `reserveChatMediaUpload`, so they do not run Storage rules.
- Shared media writes use signed upload URLs minted by `reserveSharedMediaUpload`, so they do not run Storage rules.
- Chat media reads check `chats/{chatId}` so deleted chats cannot read media.
- Report evidence upload checks the matching report upload reservation doc.

Planning estimates:

| Storage operation | Expected Firestore rules reads |
| --- | ---: |
| Avatar owner upload/delete | about 1 `RR` on moderation |
| Avatar read | 0 `RR` |
| Chat media upload | 0 `RR`; signed upload URL bypasses Storage rules after callable checks |
| Chat media read | about 1 `RR` on chat deletion gate |
| Shared media upload | 0 `RR`; signed upload URL bypasses Storage rules after callable checks |
| Shared media read | 0 `RR` |
| Report evidence upload | about 1 `RR` on upload reservation |

## Auth and passkeys

### New passkey registration

Code:

- `functions/passkey/register.js`
- `functions/lib/passkey.js`
- `functions/lib/userdoc.js`
- web client `apps/web/src/lib/passkey.js`
- iOS client `apps/ios/src/lib/passkeys.js`

`passkeyRegisterOptions`:

- 1 `FN`.
- Creates a new uid and FIDO challenge options.
- `storeChallenge` writes `passkey_challenges/{challenge}`.
- Cost: 1 `FW`.

`passkeyRegisterVerify`:

- 1 `FN`.
- `consumeChallenge` transaction:
  - reads `passkey_challenges/{challenge}`: 1 `FR`.
  - deletes `passkey_challenges/{challenge}`: 1 `FD`.
- `admin.auth().createUser({ uid })`: Firebase Auth adapter operation; no modeled Firestore/Storage op.
- Writes `passkeys/{credentialId}`: 1 `FW`.
- `ensureUserDoc(uid)`:
  - reads `users/{uid}`: 1 `FR`.
  - new account path writes default settings to `users/{uid}`: 1 `FW`.
- Creates Firebase custom token with no profile-derived custom claims: Firebase Auth/Admin operation, no modeled Firestore/Storage op.

Base new-registration total:

- 2 `FN`.
- 2 `FR`.
- 3 `FW`.
- 1 `FD`.

Web-only follow-up:

- `signInWithCustomToken`.
- ID token fetch.
- No Next.js session-cookie route.

### Existing passkey login

Code:

- `functions/passkey/login.js`
- `functions/lib/passkey.js`
- `functions/lib/userdoc.js`
- web/iOS passkey clients.

`passkeyLoginOptions`:

- 1 `FN`.
- Writes `passkey_challenges/{challenge}`: 1 `FW`.
- If a remembered `uid` is supplied:
  - queries `passkeys where uid == uid and rpId == rpId`.
  - cost is `max(1, K)` `FR` where `K` is matching passkey docs.
- If no `uid` is supplied:
  - skips passkey query.

`passkeyLoginVerify`:

- 1 `FN`.
- Consumes challenge:
  - 1 `FR`.
  - 1 `FD`.
- Reads `passkeys/{credentialId}`: 1 `FR`.
- Calls Auth get-user.
- Updates passkey counter: 1 `FW`.
- `ensureUserDoc(uid)` reads `users/{uid}`: 1 `FR`.
- Existing normal user path writes 0 user docs.
- Creates custom token with no profile-derived custom claims.

Base login without remembered uid:

- 2 `FN`.
- 3 `FR`.
- 2 `FW`.
- 1 `FD`.

Base login with remembered uid:

- 2 `FN`.
- `3 + max(1, K)` `FR`.
- 2 `FW`.
- 1 `FD`.

Failure variants:

- Bad/missing challenge still costs the options function write if options was called.
- Verify failures after challenge consume can still pay challenge read/delete.
- Dangling passkey credential handling may delete the passkey doc if Auth user is missing.

## Web route guard costs

Code:

- `apps/web/src/lib/routeguards.js`
- authenticated layouts and onboarding layouts.

`getOnboardingState(uid)` reads in parallel:

- `profiles/{uid}`: 1 `FR`.
- `seeds/{uid}`: 1 `FR`.
- `users/{uid}`: 1 `FR`.

Each call costs 3 `FR`. These are Admin SDK reads, so no Firestore `RR`.

Routes that call onboarding/vault guards can add this repeatedly during account creation:

- root `/` authenticated decision.
- onboarding username layout.
- onboarding avatar layout.
- onboarding password layout.
- onboarding community layout.
- vault layout.

The compact action table excludes repeated route-guard churn unless explicitly noted.

## Account creation plus onboarding

### Username step

Code: `functions/user/onboarding/setusername.js`.

Transaction:

- reads `usernames/{username}`: 1 `FR`.
- writes `usernames/{username}`: 1 `FW`.
- writes/merges `profiles/{uid}.username`: 1 `FW`.

Total:

- 1 `FN`.
- 1 `FR`.
- 2 `FW`.

Failure variants:

- invalid/reserved/banned username can fail before Firestore access.
- taken username costs the username doc read and no writes.

### Avatar step

Code:

- web `apps/web/src/lib/user/actions.js`.
- iOS `apps/ios/src/lib/avatarupload.js`.
- shared `shared/files.js`.
- `storage.rules`.
- `firestore.rules`.

Skip avatar:

- client updates `profiles/{uid}.avatar = null`: 1 `FW`.
- expected `RR`: 0, because avatar-null path does not need moderation lookup.

Upload avatar:

- `uploadBytes` to `{uid}/avatar.webp`: 1 `SA`.
- Storage rules owner avatar write checks moderation: about 1 `RR`.
- `getDownloadURL`: 1 `SB`.
- client updates `profiles/{uid}.avatar` generation: 1 `FW`.
- Firestore rules non-null avatar update checks moderation: about 1 `RR`.
- stored avatar bytes and future download egress apply.

Delete avatar:

- Storage `deleteObject`: free delete operation.
- owner Storage rules can check moderation: about 1 `RR`.
- profile update to avatar null: 1 `FW`.

### Seed/password creation

Code:

- web `apps/web/src/app/(authenticated)/(onboarding)/getpassword/page.js`.
- iOS `apps/ios/app/(onboarding)/getpassword.js`.

Flow:

- reads `seeds/{uid}`: 1 `FR`.
- if missing, writes `seeds/{uid}` with encrypted seed: 1 `FW`.

Rules:

- no dependent reads.

### Community acknowledgment

Code:

- web `apps/web/src/app/(authenticated)/(onboarding)/community/communityack.js`.
- shared `shared/providers/userprovider.js`.

Flow:

- merges community rules fields into `users/{uid}`: 1 `FW`.

Rules:

- no dependent reads.

### First vault unlock key setup

Code:

- `shared/vault.js`.
- `functions/user/onboarding/setpks.js`.

`setWalletPK` missing-key path:

- 1 `FN`.
- reads `profiles/{uid}`: 1 `FR`.
- duplicate query `profiles where walletPKs.{network} == walletPK limit 1`: at least 1 `FR`.
- writes/merges `profiles/{uid}.walletPKs.{network}`: 1 `FW`.

`setWalletPK` existing matching-key path:

- 1 `FN`.
- reads `profiles/{uid}`: 1 `FR`.
- if casing differs, may write normalized value: 1 `FW`.
- if exact match, no write.

`setChatPK` missing-key path:

- 1 `FN`.
- reads `profiles/{uid}`: 1 `FR`.
- duplicate query `profiles where chatPK == chatPK limit 1`: at least 1 `FR`.
- writes/merges `profiles/{uid}.chatPK`: 1 `FW`.

`setChatPK` existing matching-key path:

- 1 `FN`.
- reads `profiles/{uid}`: 1 `FR`.
- no write.

### Presence on unlock

Code: `cloud.user.active.write` in `shared/cloud/firebase.js`.

- unlock writes `profiles/{uid}.active = true`: 1 `FW`.
- lock/sign-out/account switch writes `active = false`: 1 `FW`.
- owner active update rules do not need dependent reads.

### Base complete-account total

Assumptions:

- passkey registration succeeds.
- avatar is skipped.
- username is available.
- seed is missing.
- wallet/chat keys are missing.
- duplicate key queries return no docs but still count query minimum.
- excludes repeated web route-guard reads and normal session startup listeners.

Total:

- 5 `FN`.
- 8 `FR`.
- 11 `FW`.
- 1 `FD`.

Breakdown:

- passkey registration: 2 `FN`, 2 `FR`, 3 `FW`, 1 `FD`.
- username: 1 `FN`, 1 `FR`, 2 `FW`.
- seed: 1 `FR`, 1 `FW`.
- community ack: 1 `FW`.
- avatar skip: 1 `FW`.
- wallet key: 1 `FN`, 2 `FR`, 1 `FW`.
- chat key: 1 `FN`, 2 `FR`, 1 `FW`.
- presence active: 1 `FW`.

Avatar upload variant:

- same profile avatar write count as skip.
- add 1 `SA`.
- add 1 `SB`.
- add about 2 `RR`.
- add stored and downloaded bytes.

## Normal app launch and vault unlock

### Authenticated user provider

Code: `shared/providers/userprovider.js`.

On signed-in client mount:

- listener `admins/{uid}`: 1 initial `FR`.
- listener `users/{uid}`: 1 initial `FR`.
- listener `moderation/{uid}`: 1 initial `FR`.
- listener `profiles/{uid}`: 1 initial `FR`.
- listener/query `users/{uid}/blocked`: `max(1, B)` `FR`.

Base provider listener reads:

- `4 + max(1, B)` `FR`.

Later updates:

- every delivered update to those docs is another `FR` per connected client.
- blocked query changes also deliver reads.

Avatar load:

- if profile has avatar and local cache misses, `readFile` normally uses `getBytes`: 1 `SB` plus bytes.
- React Native fallback may use `getDownloadURL` plus fetch; still a Storage metadata/read operation plus bytes.

### Bitcoin provider

Code: `shared/providers/bitcoinprovider.js`.

- listener `bitcoin/current`: 1 initial `FR`.
- every minute update delivered while mounted: 1 `FR`.

This converts one global write/minute into one read/minute per mounted client.

### Vault provider

Code:

- web `apps/web/src/components/providers/vaultprovider.js`.
- iOS `apps/ios/src/providers/vaultprovider.js`.

Web:

- after uid loads, reads `seeds/{uid}`: 1 `FR`.

iOS:

- listens to `seeds/{uid}`: 1 initial `FR`, plus future delivered changes.

Unlock:

- if wallet key missing, add `setWalletPK` cost.
- if chat key missing, add `setChatPK` cost.
- writes presence active: 1 `FW`.

### Chat list baseline

Code:

- `shared/chat/list.js`.
- `shared/chat/usechatlist.js`.

When unlocked and chat list is active:

- cached chat-list hydrate also runs the same `checkChats` pass before rendering a saved snapshot; if the live server snapshot arrives first, the cached result is ignored.
- query listener `users/{uid}/chats orderBy ts desc limit 15`.
- initial cost: `max(1, C15)` `FR`.
- after decrypting owner entries, calls `checkChats` once per resolved page/list snapshot: 1 `FN`, plus up to one parent `chats/{chatId}` `FR` per unique owner entry in the page. Parent-doc absence means active; parent `deleted` means stale owner entry cleanup.
- inbox ping listener `users/{uid}/inbox orderBy ts desc limit 25`.
- ping processing reads at most one pointed message per touched chat per batch, not one message per ping.
- future owner chat entry and inbox ping updates delivered to listeners cost additional `FR`.

`loadMoreChats`:

- reads next page of 20 owner chat entries.
- cost: up to 20 owner-entry `FR`, minimum 1, plus one `checkChats` `FN` and up to 20 parent chat `FR`.

`ensureChat`:

- if selected chat is not in list, reads the deterministic owner chat entry, then checks the parent deleted marker through `checkChats`.

### Message warming

Code:

- `shared/chat/messages/session/config.js`.
- `shared/chat/messages/session/index.js`.
- `shared/chat/messages/query.js`.

Current constants:

- `TOP_CHAT_WARM_COUNT = 1`.
- `EAGER_CHAT_WARM_COUNT = 1`.
- `CHAT_WARM_BATCH_SIZE = 20`.
- `MSG_QUERY_MAX_DOCS = 60`.
- media warming disabled.

Each warmed chat:

- attaches an adaptive latest message listener.
- starts with 20 latest message docs and expands only if the client cannot resolve 20 post-retention readable messages.
- caps foreground reads at 60 docs for control-heavy, hidden, expired, or unavailable-message spans.
- costs 20 message `FR` in normal chats and up to 60 `FR` at the cap.
- rule estimate: about 3 `RR`.
- can compact redundant control docs after decrypting the latest batch. Warmed batches may delete display docs only when both hidden checkpoints already exist; route release owns writing this client's hidden checkpoint because visible-message holds are route-owned.
- no Storage media bytes because media warming is disabled.

Session maximum from warming:

- immediate warm 1 chat: normally 20 `FR`, capped at 60 `FR`.

Opening the chat route later uses the same 20-readable-message target.

### Peer/profile refresh

Code:

- `shared/providers/peerprovider.js`.
- `shared/peers.js`.

Costs:

- recent peer refresh can read up to 50 profiles per refresh interval.
- profile-by-uid is 1 `FR`.
- avatar URL refresh on changed avatar generation adds 1 `SB`.
- batch profile loads use `in` queries in chunks of 10, with query minimum per chunk.

### Practical launch formulas

Existing account, excluding key setup because keys exist:

Web:

- route guard: 3 `FR`.
- seed read: 1 `FR`.
- user provider listeners: 4 `FR`.
- blocked query: `max(1, B)` `FR`.
- bitcoin listener: 1 `FR`.
- chat list: `max(1, C15)` `FR`.
- message warming: normally 20 `FR`, capped at 60 `FR`.
- presence active: 1 `FW`.
- bitcoin while mounted: 1 `FR` per minute.

iOS:

- seed listener: 1 `FR`.
- user provider listeners: 4 `FR`.
- blocked query: `max(1, B)` `FR`.
- bitcoin listener: 1 `FR`.
- chat list: `max(1, C15)` `FR`.
- message warming: normally 20 `FR`, capped at 60 `FR`.
- presence active: 1 `FW`.
- bitcoin while mounted: 1 `FR` per minute.
- push registration can add costs if token/device state changes.

## Chat message send paths

### Normal visible text

Code:

- `shared/chat/actions/send.js`.
- `shared/chat/messages/write.js`.
- `functions/chat/push.js`.

Client batch:

- writes `chats/{chatId}/messages/{msgId}`: 1 `FW`.
- message create rules check `chats/{chatId}` for the deletion gate: about 1 `RR`.
- updates the sender owner chat entry: 1 `FW`.
- calls `push` with a sealed recipient inbox ping.

`push` callable:

- callable invocation: 1 `FN`.
- rate limit bucket read/write.
- reads sender moderation doc.
- reads `users/{recipientUid}/blocked/{senderUid}`.
- writes `users/{recipientUid}/inbox/{pingId}`: 1 `FW`.
- reads the receiver's private push docs query: `max(1, P)` `FR`.
- if no active push route exists, returns without reading the sender profile.
- if an OS notification will be sent, reads `profiles/{senderUid}.username`: 1 `FR`.

Base established delivery-only or no-active-route reads:

- about `3 + max(1, P)` `FR` inside the function, plus the rate-limit write.
- plus about 1 client `RR` on `chats/{chatId}` for the message create rule.
- with no active route, `P` is the empty-query minimum, so the visible send is about 5 read-equivalent operations.

Base established OS-notification reads:

- about `4 + max(1, P)` `FR` inside the function after adding the sender profile username read.
- plus about 1 client `RR` on `chats/{chatId}` for the message create rule.
- with one active push route, the visible send is about 6 read-equivalent operations.

First message to a peer with no local active chat id:

- calls `openChatLink`: 1 `FN`.
- rate limit transaction reads/writes two `rate_limits` buckets: 2 `FR`, 2 `FW`.
- reads `links/{linkId}`: 1 `FR`.
- if no active chat exists, writes `links/{linkId}.chat`: 1 `FW`.
- if an active chat id exists, reads `chats/{activeChatId}` to reject deleted chats before reusing it: 1 `FR`.
- this link-open cost is not paid by established sends that already carry `chatId` and `linkId`.

Push delivery:

- APNS/Expo calls are inside the function.
- no separate Firebase push fee counted.
- stale tokens can create cleanup writes.

Live listener fanout:

- sender chat list may receive owner chat entry update: +1 `FR`.
- receiver inbox listener may receive ping doc if online: +1 `FR`, then ping processing can read the pointed latest message for that chat.
- each open message listener receives message doc: +1 `FR`.
- listener rule checks may re-run.

### Payment request message

Code:

- web chat command/request UI.
- iOS transfer/chat request UI.
- same send path as normal text.

Cost:

- same as visible text message.
- server cannot tell encrypted request body apart for cost purposes before message body decryption, which server does not do.

### Long text

Code:

- `shared/chat/actions/send.js`.
- `shared/chat/media.js`.
- `shared/files.js`.

Long text is converted to file attachment:

- reserves and uploads an encrypted Storage blob under the chat media path.
- then send attachment message using the visible-message path.

### Image/audio/video/file

Code:

- `sendAttachment`.
- `uploadAttachmentMsg`.
- `putImg`, `putMp3`, `putMp4`, `putFile`.

Send:

- calls `reserveChatMediaUpload` to sign the upload: 1 `FN`.
- upload signer rate-limits three windows: 3 `FR`, 3 `FW`.
- upload signer reads usage quota and `chats/{chatId}` deletion gate: 2 `FR`.
- upload signer writes usage quota: 1 `FW`.
- uploads encrypted Storage object `chat-media/{chatId}/{messageKey}/main` through the signed URL: 1 `SA`.
- signed upload bypasses Storage rules, so upload rules add 0 `RR`.
- solo/latest visible send path:
  - writes message doc and sender owner entry before calling `push`.
  - planning reads are about 6 read-equivalent operations when the receiver has one active push route, and about 5 when no active route exists.
  - runs `push`: 1 `FN`.
- intermediate queued sends to the same chat can write only the encrypted message doc before the latest queued send writes the owner entry and inbox ping.
- stored bytes apply.

Download/read media:

- object read/download: 1 `SB`.
- chat media reads check the chat deletion gate: about 1 `RR`.
- downloaded bytes/egress apply.
- shared media reads do not check a chat and have 0 `RR`.

Share existing attachment:

- uploads or reuses one encrypted shared object under `shared/{sharedId}`.
- first shared upload calls `reserveSharedMediaUpload`: 1 `FN`, about 4 `FR`, 4 `FW`, and 1 `SA`.
- forwarding an already-shared media message has 0 upload/reservation cost.
- sends a new visible message using the normal visible-message path.
- future readers download the shared Storage object; the destination message does not reveal the original source chat id.

### Multi-target attachment

Code: `sendAttachmentMany`, `share`.

Media:

- one upload per destination chat: `N` `SA`.
- one share upload can be reused across a multi-recipient share batch: 1 `SA` plus `N` visible message sends.
- each target sends one visible message using the normal visible-message path.

Formula for direct chat-media upload to `N` established targets:

- `N` signed upload calls: `N * about 5` `FR`, `N * 4` `FW`, `N` `FN`, `N` `SA`.
- `N` visible message sends: `N * about 6` read-equivalent operations on active OS-notification paths, or `N * about 5` when no active route exists, `N * 4` `FW`, `N` `FN`.

Formula for one shared upload to `N` established targets:

- 1 shared signed upload call: 1 `FN`, about 4 `FR`, 4 `FW`, 1 `SA`.
- `N` visible message sends: `N * about 6` read-equivalent operations on active OS-notification paths, or `N * about 5` when no active route exists, `N * 4` `FW`, `N` `FN`.

### Read receipt

Code:

- `sendReadReceipt`.
- `shared/chat/usemessages.js`.
- no push function.

Client:

- writes one message doc: 1 `FW`.
- no owner entry or inbox ping write.
- message create rules check the chat deletion gate: about 1 `RR`.

Push:

- does not run `push`.

### Reaction

Code: `sendReaction`.

Same as read receipt:

- 1 `FW`.
- about 1 `RR` on the chat deletion gate.
- no `FN`.
- no push-trigger reads.

### Chat retention change

Code: `setChatRetention`.

Steps:

- writes the sender owner chat entry with encrypted retention settings: 1 `FW`.
- sends system message with `updateLastMsg: false`:
  - message doc write: 1 `FW`.
  - message create rules check the chat deletion gate: about 1 `RR`.
  - no inbox ping.

## Opening and reading chats

### Open chat route

Code:

- `shared/chat/messages/query.js`.
- `shared/chat/usemessages.js`.
- web/iOS chat route components.

Costs:

- if chat missing, derive the owner entry id from `chatId` and read one owner chat entry.
- latest message listener targets 20 post-retention readable messages:
  - starts at 20 latest message docs.
  - doubles the active listener limit until 20 post-retention readable messages resolve or the 60-doc foreground cap is reached.
  - costs 20 message `FR` in normal chats and up to 60 `FR` in control-heavy spans.
  - message rules add about 1 `RR` on `chats/{chatId}` for the deletion gate.
- no automatic older prefetch after open.
- media bytes are not loaded unless rendered/read and missing local cache.
- seeing latest peer message can schedule read receipt.

### Load older messages

Code: `shared/chat/messages/query.js`.

- older fetches target 20 post-retention readable messages.
- one-off reads start with 20 older docs and keep fetching older chunks only if fewer than 20 post-retention readable messages resolve.
- each older load is capped at 60 docs for control-heavy, hidden, expired, or unavailable-message spans.
- minimum 1 `FR`.
- message rules add about 1 `RR` on `chats/{chatId}` for the deletion gate.

## Message update, save, and delete paths

### Edit/update message

Code: `shared/chat/messages/write.js` `updateMsg`.

Base:

- appends a signed encrypted edit/pay-confirm action doc: 1 `FW`.
- message create rules check the chat deletion gate: about 1 `RR`.
- no mutable message-body rewrite and no parent chat mutation.

Payment request confirmation:

- web/iOS Spark payment is external.
- after tx id returns, the payer appends a signed `pay_confirm` action with `updateMsg`.

### Save message forever

Code:

- save hooks.
- `setChatMessageTtl`.

Text/request:

- calls `setChatMessageTtl`: 1 `FN`.
- rate limit transaction reads/writes two `rate_limits` buckets: 2 `FR`, 2 `FW`.
- reads `chats/{chatId}` to reject deleted chats: 1 `FR`.
- reads the target message doc: 1 `FR`.
- save updates the shared message doc `ttl` to `null`: 1 `FW`.
- unsave updates the shared message doc to a fresh normal server TTL: 1 `FW`.

Attachment:

- same message TTL update path.
- save sets the chat media object's Storage `temporaryHold = true`: 1 `SA` metadata update.
- unsave sets `temporaryHold = false` after the message doc is temporary again: 1 `SA` metadata update.

### `setChatMessageTtl(permanent: true)`

Code: `functions/chat/deletechat.js`.

Work:

- rate limit transaction reads/writes two `rate_limits` buckets: 2 `FR`, 2 `FW`.
- reads `chats/{chatId}` to reject deleted chats: 1 `FR`.
- reads each target message doc: 1 `FR` per message.
- sets Storage `temporaryHold = true` for each target chat media object before making the message permanent: 1 `SA` per media object.
- updates each temporary message doc to `ttl: null`: 1 `FW` per updated message.

Total one text save:

- 1 `FN`.
- 4 `FR`.
- 3 `FW`.

Total one media save adds:

- 1 `SA`.

### `setChatMessageTtl(permanent: false)`

Code: `functions/chat/deletechat.js`.

Work:

- rate limit transaction reads/writes two `rate_limits` buckets: 2 `FR`, 2 `FW`.
- reads `chats/{chatId}` to reject deleted chats: 1 `FR`.
- reads each target message doc: 1 `FR` per message.
- updates each permanent message doc to a fresh normal server TTL: 1 `FW` per updated message.
- clears Storage `temporaryHold` for each target chat media object after the message doc is temporary: 1 `SA` per media object.

Total one text unsave:

- 1 `FN`.
- 4 `FR`.
- 3 `FW`.

Total one media unsave adds:

- 1 `SA`.

### Delete message

Code: `deleteMsg`.

Steps:

- calls `deleteChatMessage`: 1 `FN`.
- callable rate-limits two windows: 2 `FR`, 2 `FW`.
- callable clears Storage temporary hold and deletes the media object when the client marks the message as media: 1 `SA` metadata update plus free delete.
- callable deletes the source message doc: 1 `FD`.
- active listeners treat the removed source doc as the delete signal and clear local memory/cache.

### TTL changes

Code:

- `listenToLatestMsgs` / `loadOlderMsgs` client expired-message cleanup.
- Firestore TTL policy on collection group `messages`, field `ttl`.
- Firestore TTL policy on collection group `inbox`, field `ttl`.

Shape:

- new message docs carry their initial `ttl`.
- sealed inbox pings carry a fixed 21-day `ttl`.
- saving sets the shared message doc `ttl` to `null`; unsaving sets a fresh normal server TTL.
- routine physical cleanup is handled by Firestore TTL and encrypted hidden-message maintenance callables, not client plaintext TTL shortening.

Active clients keep backend TTL dumb:

- new messages start with the fixed 21-day TTL,
- saving forever sets the shared message doc `ttl` to `null`,
- read handling and hidden-message checkpoints do not shorten plaintext TTL.

Expired message cleanup:

- message queries inspect `ttl` before filtering expired docs out of the rendered batch.
- unprocessed inbox pings stay available for up to 21 days so the recipient can decrypt them and create or update their owner chat entry.
- native Firestore TTL is the cleanup path; TTL deletes still count as document deletes.

Smart hidden-message cleanup:

- clients append encrypted `hid` checkpoint control messages after their UI has released read-hidden messages.
- if both participants' hidden checkpoints cover an unsaved received display message, the recipient client may batch delete that message doc through `deleteChatMessages`.
- warmed latest batches may delete only from hidden checkpoints already present in the stream; they must not create new hidden checkpoints.

Control-message compaction:

- clients compact only after decrypting the opaque message stream.
- safe deletes include superseded reactions, duplicate read receipts with the same sender and target, old hidden checkpoints covered by a newer checkpoint from the same sender, and retention setting docs replaced before any display message used them.
- full read-receipt compaction is intentionally avoided because older receipt timestamps are the first-seen clock for `24h after seen` retention.
- smart message cleanup passes media keys for attachment messages so hard-deleted message media can be deleted immediately; unsaved media that is not explicitly deleted ages out through the Storage lifecycle rule.

## Delete chat

Code:

- `shared/chat/actions/delete.js`.
- `functions/chat/deletechat.js`.

Steps:

- client hides the chat immediately.
- calls `deleteChat` with one chat target or a batch: 1 `FN`.
- delete intentionally does not read moderation state or rate-limit state; signed-in users can delete private chat data even if chat-banned, and account deletion must be able to mark all known chats deleted.
- for each target with `linkId`, function reads `links/{linkId}`: 1 `FR`.
- function tags every parent `chats/{chatId}` as deleted before cleanup starts and clears supplied `links/{linkId}.chat.id` values so clients stop reads/writes for messages and chat media while the same peer pair can open a fresh active chat id; the tags store no participant ids and remain after cleanup.
- per target, tagging writes `chats/{chatId}` and usually writes `links/{linkId}` when supplied: up to 2 `FW`.
- function overwrites then deletes each caller owner chat entry when `entryId` is provided: 1 `FW`, 1 `FD` per entry.
- normal manual chat delete runs best-effort physical cleanup after the read gates are written. Account-delete chat batches pass `cleanup: false` so account deletion waits only for every known chat to be marked deleted.
- scheduled `cleanupDeletedChats` runs once per day as a backstop to drain deleted chats and retry unfinished work.
- cleanup drains message docs and Storage objects under `chat-media/{chatId}/` in chunks.
- each cleanup pass queries up to 300 message docs and lists up to 100 Storage objects.
- each Storage object cleanup sets `temporaryHold = false` before free deletion, so media-heavy chats pay one Storage metadata update per object.
- the schedule runs daily and reads up to 100 pending deleted chat docs; when no deletes are pending, the planning cost is one scheduled function invocation and one empty-query read per day.

## Delete account

Code: `functions/user/actions/deleteaccount.js`.

Steps:

- while the vault is still unlocked, clients drain decryptable inbox pings into owner chat entries, page through decryptable owner chat entries, and call batch `deleteChat` in 400-chat mark-only chunks before account deletion. If chat marking fails, account deletion should not continue; physical cleanup is not on this critical path.
- callable invocation: 1 `FN`.
- recursively deletes `users/{uid}`:
  - deletes user doc and owner subcollections such as `blocked`, `push`, `chats`, and `inbox`.
  - recursive enumeration can add reads/listing.
- deletes avatar object `{uid}/avatar.webp` through Admin SDK:
  - Cloud Storage delete is free operation.
  - no Storage rules reads.
- batch deletes:
  - `seeds/{uid}`: 1 `FD`.
  - `profiles/{uid}`: 1 `FD`.
  - `moderation/{uid}`: 1 `FD`.
- queries `usernames where uid == uid`: `max(1, U)` `FR`.
- deletes `U` username docs.
- queries `passkeys where uid == uid`: `max(1, K)` `FR`.
- deletes `K` passkey docs.
- deletes Auth user.
- canonical opaque chat docs and chat media blobs are expected to have been marked deleted through client-assisted batch `deleteChat`; physical cleanup continues through the delete callable's best-effort pass, scheduled deleted-chat cleanup, TTL, lifecycle, and maintenance cleanup.

Minimum-ish account with no usernames/passkeys still pays query minimums:

- 1 usernames query read.
- 1 passkeys query read.
- deletes for seed/profile/moderation and user recursive tree if docs exist.

## Push device actions

Code:

- `functions/user/actions/push.js`.
- iOS `apps/ios/src/lib/push.js`.
- iOS `apps/ios/src/providers/pushprovider.js`.

### `setPush`

Callable:

- 1 `FN`.

Idempotent no-op:

- reads current `users/{uid}/push/{did}`: 1 `FR`.
- if the stored device doc already matches the submitted token/environment and current owner-index version, returns before rate limiting or writing.

Changed device/token:

- rate limit transaction reads/writes one hourly `rate_limits` bucket.
- reads owner docs:
  - `push_device_owners/{hash(did)}`.
  - one `push_token_owners/{hash(token)}` doc for each APNS/Expo token provided.
- stale owner hits add reads for old push docs and deletes those stale push docs.
- if current doc does not exist:
  - queries oldest push docs ordered by updatedAt, limit 4.
  - cost is between 1 and 4 `FR`.
  - if limit exceeded, deletes oldest different device: 1 `FD`.
- writes current push doc: 1 `FW`.
- writes current device/token owner docs.

Common new APNS-only device, no stale refs:

- 1 `FN`.
- about 5 `FR`.
- about 4 `FW`.

Common unchanged APNS/Expo device refresh after the owner-version marker exists:

- 1 `FN`.
- 1 `FR`.
- 0 `FW`.
- 0 `rate_limits` writes.

### `dropPush`

Callable:

- 1 `FN`.
- if `did` provided, adds direct ref for delete with no read.
- query current user's push by native token if provided: at least 1 `FR`.
- query current user's push by Expo token if provided: at least 1 `FR`.
- deletes resolved refs: `D` `FD`.

## Reports and moderation surfaces

Code:

- `functions/user/actions/report.js`.
- web report dialog.
- iOS report settings/message paths.

Without file evidence:

- callable invocation: 1 `FN`.
- reads `profiles/{targetUid}`: 1 `FR`.
- writes `reported/{targetUid}/reports/{reportId}`: 1 `FW`.
- writes/merges `reported/{targetUid}` aggregate: 1 `FW`.

With file evidence:

- client first calls `reserveReportEvidenceUpload`: 1 `FN`.
- reservation callable rate-limits three windows: 3 `FR`, 3 `FW`.
- reservation callable reads upload reservation and usage quota: 2 `FR`.
- reservation callable writes upload reservation and usage quota: 2 `FW`.
- client uploads evidence to `reports/{reporterUid}/{targetUid}/{evidenceId}`: 1 `SA`.
- report evidence rules read the upload reservation: about 1 `RR`.
- stored bytes apply.
- then callable cost above.

Admin report viewing:

- admin pages listen/read reports, profiles, report detail, events, and Storage evidence as needed.
- this is not modeled as a normal user action but matters with moderation volume.

## Search, profiles, settings, blocks

### Profile lookup and search

Code:

- `shared/peers.js`.
- `shared/search/remote.js`.
- `shared/search/roles.js`.

Costs:

- profile by uid: 1 `FR`.
- profile by walletPK/chatPK/username: limit-1 query, 1 `FR` minimum.
- username prefix search: up to 15 `FR`, minimum 1.
- role search: returned docs, minimum 1; use Query Explain for index reads.
- batch profile load by wallet/chat keys:
  - `in` query chunks of 10.
  - returned docs, minimum 1 per chunk.
- avatar URL refresh: 1 `SB` if avatar generation changed and URL is requested.

### Block/unblock

Code: `shared/providers/userprovider.js`.

- block peer: writes `users/{uid}/blocked/{peerUid}`: 1 `FW`.
- unblock peer: deletes that doc: 1 `FD`.
- no dependent rules reads.

Each future message trigger still reads `users/{receiverUid}/blocked/{senderUid}`.

### Settings

Code:

- `shared/settings.js`.
- `shared/providers/userprovider.js`.

`updateSettings`:

- reads `users/{uid}`: 1 `FR`.
- writes merged settings to `users/{uid}`: 1 `FW`.
- no dependent rules reads.

## Scheduled BTC data

Code: `functions/btc/btc.js`.

Every minute:

- scheduled function invocation: 1 `FN`.
- normal steady-state write to `bitcoin/current`: 1 `FW`.
- external BTC and fee API requests consume function runtime/network, not Firebase reads.

Per day:

- 1,440 `FN`.
- 1,440 `FW`.

Fanout:

- every mounted authenticated client reads `bitcoin/current` initially.
- every mounted authenticated client reads every minute update while mounted.

## Wallet and payments

Wallet boot:

- Firebase cost only when wallet public key is missing and `setWalletPK` runs.
- Spark wallet boot, balance, transfer history, invoices, and sends are external Spark/network costs.

Direct wallet send:

- no Firestore write by itself in the current wallet flow.
- if the send is paying a chat request, add request-confirmation message patch cost.

Request money:

- QR generation/scanning is local.
- request sent through chat has same cost as payment request message.
- peer search/lookup costs profile reads.

## Bot and admin paths

### Toggle bot power

Code:

- `functions/admin/setbotpower.js`.
- `functions/lib/bots.js`.

Costs:

- callable invocation: 1 `FN`.
- admin check reads `admins/{adminUid}`: 1 `FR`.
- resolve bot id:
  - reads `bots/{identifier}`: 1 `FR`.
  - if miss, queries `bots where username == identifier limit 1`: at least 1 `FR`.
  - if miss, reads `usernames/{identifier}`: 1 `FR`.
  - if username doc points to uid, reads `bots/{uid}`: 1 `FR`.
- power on/off writes:
  - `bots/{botUid}`: 1 `FW`.
  - `profiles/{botUid}.active`: 1 `FW`.

### Bot runtime baseline

Code: `apps/bot/src/runtime.js`.

Runtime lease:

- startup transaction reads `runtimes/bot`: 1 `FR`.
- writes runtime lease: 1 `FW`.
- heartbeat writes `runtimes/bot` every runtime heartbeat interval: 1 `FW` each.
- release reads runtime doc and writes stopped state if owned by runtime.

Enabled bots listener:

- query `bots where enabled == true`: `max(1, enabled bot count)` `FR`.
- future bot doc updates delivered to listener: additional `FR`.

Per active bot session:

- writes bot boot/running status: 1 `FW`.
- writes `profiles/{botUid}.active = true`: 1 `FW`.
- attaches owner chat entry listener:
  - initial `max(1, bot chat count)` `FR`.
  - future owner chat entry updates deliver more `FR`.
- attaches inbox ping listener:
  - initial query minimum or pending ping docs.
  - future ping docs deliver more `FR`.
- session close writes `profiles/{botUid}.active = false`: 1 `FW`.

### User messages a bot

The user's outbound message pays the normal send cost. Because bot accounts normally have no push route docs, user-to-bot delivery usually takes the no-active-route path and skips the sender-profile username read after writing the bot inbox ping. The bot runtime then pays its own Admin SDK costs:

- bot inbox listener receives the ping doc: 1 `FR`.
- bot ping processing may create/update the bot owner chat entry and then queue message processing.
- reads bot read cursor `bots/{botUid}/reads/{chatId}` on runtime cache miss: 1 `FR`.
- queries new messages after cursor:
  - `max(1, new message count)` `FR`.
  - if initial query empty but parent recency indicates new message, retries after 250 ms, adding another query minimum.
- if the batch has no peer-authored docs, advances the bot read cursor and skips chat settings decrypt, peer profile resolution, moderation, blocking, receipts, and replies.
- resolves peer by chatPK on cache miss:
  - query `profiles where chatPK == peerChatPK limit 2`: at least 1 `FR`.
- checks moderation/blocking:
  - `moderation/{peerUid}`: 1 `FR`.
  - `users/{botUid}/blocked/{peerUid}`: 1 `FR`.
  - `users/{peerUid}/blocked/{botUid}`: 1 `FR`.
  - `moderation/{botUid}`: 1 `FR`.
- writes bot read cursor once per advanced message batch: 1 `FW`.
- if bot sends read receipt and hidden checkpoint:
  - writes two message docs: 2 `FW`.
  - read-receipt and hidden-checkpoint control messages do not trigger push.
- if bot replies with text/request:
  - deterministic message create, with no existence pre-read.
  - writes message doc and bot owner chat entry before calling `push`.
  - `push` writes the user inbox ping, reads the user's private push route docs, and only reads the bot profile username if an OS notification will actually be sent.
- if bot mirrors attachment:
  - deterministic mirror message preflight before reading media: 1 `FR`.
  - downloads user media: 1 `SB` plus bytes.
  - uploads mirrored media: 1 `SA` plus bytes.
  - sends bot media message as above.
- if bot pays request:
  - deterministic mirrored-request preflight before Spark transfer: 1 `FR`.
  - Spark transfer external.
  - appends payer-signed payment confirmation: 1 message `FW`.
  - sends bot request/message back.

## Cost hotspots found

1. Control-heavy or mostly hidden chats can force adaptive latest-message listeners and older loads up to the 60-doc cap.
2. `bitcoin/current` updates fan out to every mounted client once per minute.
3. Push registration has query-minimum reads even when no stale docs exist.
4. Peer refresh can read up to 50 profile docs per refresh interval.
5. Account deletion recursively deletes chat/message trees and user subcollections, which is acceptable for rare deletion but expensive for chat-heavy users.
6. Media bytes are mostly user-driven; media warming is disabled, which avoids hidden Storage download costs.
