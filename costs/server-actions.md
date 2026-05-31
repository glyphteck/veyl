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
| `deleteChat` | callable | chat deletion |
| `setPush` | callable | push token registration |
| `dropPush` | callable | push token removal |
| `submitReport` | callable | user/message reporting |
| `setMediaSaved` | callable | permanent media hold bookkeeping |
| `onChatMessage` | Firestore trigger | push resolver for parent chat preview updates |
| `setBotPower` | callable | admin bot enable/disable |

## Firestore and Storage rules cost model

Rules-dependent reads are easy to hide because they are not in app code. They still bill as Firestore reads for client SDK requests.

### Firestore rules

`firestore.rules` helper reads:

- `userChatPK()` reads `profiles/{request.auth.uid}`.
- `activeBan(uid, key)` checks `moderation/{uid}` with `exists()` and `get()`.
- `isChatBanned(uid)` checks `moderation/{uid}` with `exists()` and `get()`.
- `existingChatAllowsParticipant(chatId)` reads parent `chats/{chatId}` and calls participant/profile helpers.
- `afterChatAllowsMessageCreate(chatId)` reads `getAfter(chats/{chatId})`.

Planning estimates:

| Client operation | Expected rule reads |
| --- | ---: |
| Owner presence update on `profiles/{uid}.active` | 0 `RR` |
| Owner avatar update to non-null | about 1 `RR` on `moderation/{uid}` |
| Parent chat get/list listener | about 2 `RR`: moderation + profile chat key |
| Message get/list listener | about 3 `RR`: moderation + parent chat + profile chat key |
| Message create with parent chat write | about 3 `RR`: moderation + profile chat key + `getAfter(chats/{chatId})` |
| Message update/delete | about 3 `RR`: moderation + parent chat + profile chat key |
| Parent chat update | about 2 `RR`: moderation + profile chat key |
| User settings/community/seed/block writes | 0 extra `RR` |

Rules can short-circuit and cache repeated dependent docs inside a request. Treat counts as planning estimates until measured against emulator/debug logs or billing export.

### Storage rules

`storage.rules` helper reads:

- Avatar write/delete by owner calls `isAvatarBanned(uid)`, which checks `moderation/{uid}`.
- Admin avatar delete checks `admins/{request.auth.uid}`.
- Media upload/read requires signed-in auth only and has no Firestore lookup.
- Report evidence upload requires signed-in auth/path/size only and has no Firestore lookup.

Planning estimates:

| Storage operation | Expected Firestore rules reads |
| --- | ---: |
| Avatar owner upload/delete | about 1 `RR` on moderation |
| Avatar read | 0 `RR` |
| Chat media upload/read | 0 `RR` |
| Report evidence upload | 0 `RR` |

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
- `admin.auth().createUser({ uid })`: Auth operation; count eventual sign-in as Auth MAU.
- Writes `passkeys/{credentialId}`: 1 `FW`.
- `ensureUserDoc(uid)`:
  - reads `users/{uid}`: 1 `FR`.
  - new account path writes default settings to `users/{uid}`: 1 `FW`.
- Creates Firebase custom token: Auth/Admin operation, no Firestore.

Base new-registration total:

- 2 `FN`.
- 2 `FR`.
- 3 `FW`.
- 1 `FD`.
- 1 Auth MAU after sign-in.

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
- Creates custom token.

Base login without remembered uid:

- 2 `FN`.
- 3 `FR`.
- 2 `FW`.
- 1 `FD`.
- 1 Auth MAU for the month.

Base login with remembered uid:

- 2 `FN`.
- `3 + max(1, K)` `FR`.
- 2 `FW`.
- 1 `FD`.
- 1 Auth MAU for the month.

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

### Username claim

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

Code: `shared/presence.js`.

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
- 1 Auth MAU.

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

- `shared/chat/rows.js`.
- `shared/chat/usechatlist.js`.

When unlocked and chat list is active:

- query listener `chats where participants array-contains chatPK orderBy ts desc limit 15`.
- initial cost: `max(1, C15)` `FR`.
- rule estimate: about 2 `RR`.
- future chat doc updates delivered to listener cost additional `FR`.

`loadMoreChats`:

- reads next page of 20 parent chat docs.
- cost: up to 20 `FR`, minimum 1.
- rule estimate: about 2 `RR`.

`ensureChatRow`:

- if selected chat is not in list, reads one parent chat doc: 1 `FR`.

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
- `functions/chat/messagepush.js`.
- `functions/lib/chatroute.js`.

Client batch:

- writes `chats/{chatId}/messages/{msgId}`: 1 `FW`.
- sets/merges parent `chats/{chatId}` with `participants`, `lastMsg`, `ts`: 1 `FW`.
- rules estimate: about 3 `RR` for message create with parent after-write state.

Parent chat trigger:

- every parent chat preview update runs `onChatMessage`: 1 `FN`.
- control messages do not update the parent chat preview, so they do not run this trigger.
- `resolveChatActors`:
  - sender profile query by chatPK, `limit(2)`: at least 1 `FR`.
  - receiver profile query by chatPK, `limit(2)`: at least 1 `FR`.
- push eligibility reads:
  - sender moderation: 1 `FR`.
  - receiver moderation: 1 `FR`.
  - receiver blocked-sender doc: 1 `FR`.
  - receiver push docs query: `max(1, P)` `FR`.

Base trigger reads:

- `5 + max(1, P)` `FR`.

If receiver has no registered push docs:

- push query still has query minimum, so trigger total is 6 `FR`.

Push delivery:

- APNS/Expo calls are inside the function.
- no separate Firebase push fee counted.
- stale tokens can create cleanup writes.

Live listener fanout:

- sender chat list may receive parent chat update: +1 `FR`.
- receiver chat list may receive parent chat update if online: +1 `FR`.
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

- upload encrypted Storage blob: 1 `SA` plus stored bytes.
- then send attachment message:
  - 2 `FW`.
  - about 3 `RR`.
  - 1 `FN`.
  - `5 + max(1, P)` trigger `FR`.

### Image/audio/video/file

Code:

- `sendAttachment`.
- `uploadAttachmentMsg`.
- `putImg`, `putMp3`, `putMp4`, `putFile`.

Send:

- upload encrypted Storage object `media/{mediaId}/main`: 1 `SA`.
- Storage media upload rules have 0 Firestore `RR`.
- write message doc: 1 `FW`.
- write parent chat `lastMsg`/`ts`: 1 `FW`.
- Firestore rules estimate: about 3 `RR`.
- trigger: 1 `FN` and `5 + max(1, P)` `FR`.
- stored bytes apply.

Download/read media:

- object read/download: 1 `SB`.
- downloaded bytes/egress apply.
- no Firestore read unless the message/profile docs also need loading.

Share existing attachment:

- no new upload.
- writes new message + parent chat.
- trigger same as visible message.
- future readers download original Storage object.

### Multi-target attachment

Code: `sendAttachmentMany`.

Expiring media:

- one upload total for the shared encrypted blob: 1 `SA`.
- for each target:
  - 2 `FW`.
  - about 3 `RR`.
  - 1 `FN`.
  - `5 + max(1, P_target)` trigger `FR`.

Permanent media:

- one upload for permanent upload group.
- per target also calls `setMediaSaved` with distinct stay id.

Formula for `N` expiring targets:

- 1 `SA`.
- `N * 2` `FW`.
- `N * about 3` `RR`.
- `N` `FN`.
- sum of target trigger reads.

### Read receipt

Code:

- `sendReadReceipt`.
- `shared/chat/usemessages.js`.
- `functions/chat/messagepush.js`.

Client:

- writes one message doc: 1 `FW`.
- no parent chat last-message write.
- rules estimate: about 3 `RR`.

Push:

- does not update parent chat `lastMsg` or `ts`.
- does not run `onChatMessage`.

### Reaction

Code: `sendReaction`.

Same as read receipt:

- 1 `FW`.
- about 3 `RR`.
- no `FN`.
- no push-trigger reads.

### Chat retention change

Code: `setChatRetention`.

Steps:

- updates parent chat `settings`: 1 `FW`.
- parent chat update rules: about 2 `RR`.
- sends system message with `updateLastMsg: false`:
  - message doc write: 1 `FW`.
  - message create rules: about 3 `RR`.
  - no push trigger because parent chat `lastMsg` does not change.

## Opening and reading chats

### Open chat route

Code:

- `shared/chat/messages/query.js`.
- `shared/chat/usemessages.js`.
- web/iOS chat route components.

Costs:

- if chat row missing, read parent chat: 1 `FR`.
- latest message listener targets 20 post-retention readable messages:
  - starts at 20 latest message docs.
  - doubles the active listener limit until 20 post-retention readable messages resolve or the 60-doc foreground cap is reached.
  - costs 20 message `FR` in normal chats and up to 60 `FR` in control-heavy spans.
  - rules estimate about 3 `RR`.
- no automatic older prefetch after open.
- media bytes are not loaded unless rendered/read and missing local cache.
- seeing latest peer message can schedule read receipt.

### Load older messages

Code: `shared/chat/messages/query.js`.

- older fetches target 20 post-retention readable messages.
- one-off reads start with 20 older docs and keep fetching older chunks only if fewer than 20 post-retention readable messages resolve.
- each older load is capped at 60 docs for control-heavy, hidden, expired, or unavailable-message spans.
- minimum 1 `FR`.
- rules estimate about 3 `RR`.

## Message update, save, and delete paths

### Edit/update message

Code: `shared/chat/messages/write.js` `updateMsg`.

Base:

- reads message doc: 1 `FR`.
- writes message body: 1 `FW`.
- rules estimate about 3 `RR`.

If syncing parent `lastMsg`:

- reads parent chat: 1 `FR`.
- if message cid equals current lastMsg cid, writes parent `lastMsg.body`: 1 `FW`.
- parent chat update rules estimate about 2 `RR`.

Payment request confirmation:

- web/iOS Spark payment is external.
- after tx id returns, request message is patched with `updateMsg`.

### Save message forever

Code:

- save hooks.
- `updateMsg`.
- `makeMsgPermanent`.
- `setMediaSaved` for attachments.

Text/request:

- `updateMsg` reads message and writes body/save payload:
  - 1 `FR`.
  - 1 `FW`.
  - about 3 `RR`.
- `makeMsgPermanent`:
  - reads parent chat: 1 `FR`.
  - writes message `ttl = null`: 1 `FW`.
  - if current lastMsg, writes parent `lastMsg.ttl`: 1 `FW`.
  - rules for ttl update about 3 `RR`; parent update about 2 `RR` if needed.

Attachment:

- same message update/permanent path.
- plus `setMediaSaved(true)`.

### `setMediaSaved(true)`

Code: `functions/chat/media.js`.

Transaction:

- reads `mediaStays/{mediaId}`: 1 `FR`.
- reads `mediaStays/{mediaId}/stays/{stayId}`: 1 `FR`.
- if stay exists: 0 writes.
- if new stay:
  - writes stay doc: 1 `FW`.
  - writes/merges media aggregate: 1 `FW`.
- if previous stay count was 0:
  - sets Storage `temporaryHold = true`: 1 `SA` metadata update.

Total new first stay:

- 1 `FN`.
- 2 `FR`.
- 2 `FW`.
- 1 `SA`.

### `setMediaSaved(false)`

Code: `functions/chat/media.js`.

Transaction:

- reads media aggregate: 1 `FR`.
- reads stay doc: 1 `FR`.
- if stay missing: 0 writes/deletes.
- if stay exists:
  - deletes stay doc: 1 `FD`.
  - if remaining stay count > 0, writes aggregate count: 1 `FW`.
  - if remaining stay count == 0, deletes aggregate doc: 1 `FD`.
  - if remaining stay count == 0, clears Storage temporary hold: 1 `SA` metadata update.

### Delete message

Code: `deleteMsg`.

Steps:

- if deleting a saved media message, client first runs the unsave path:
  - reseals message body without `stay`: 1 `FR` + 1 `FW`.
  - restores a temporary `ttl`: 1 parent chat `FR` + 1 message `FW`, plus parent `lastMsg.ttl` write if applicable.
  - calls `setMediaSaved(false)`, which deletes the stay and may clear the Storage temporary hold when stay count reaches zero.
- reads parent chat: 1 `FR`.
- reads message doc: 1 `FR`.
- deletes message doc: 1 `FD`.
- rules estimate for message delete: about 3 `RR`.
- if deleted message is current lastMsg:
  - updates parent chat removing `lastMsg`: 1 `FW`.
  - parent update rules: about 2 `RR`.
- no function trigger.
- media object is not deleted.

### TTL changes

Code:

- `makeMsgPermanent`.
- `makeMsgTemporary`.
- `listenToLatestMsgs` / `loadOlderMsgs` client expired-message cleanup.
- Firestore TTL policy on collection group `messages`, field `ttl`.

Shape:

- read parent chat once: 1 `FR`.
- write each message ttl update: one `FW` per item.
- if affected message is current lastMsg, update parent chat: 1 `FW`.
- rules for each message update and parent update apply.

Active clients keep backend TTL dumb:

- new messages start with the fixed 21-day TTL,
- saving forever sets message `ttl = null`,
- unsaving restores a temporary TTL,
- read handling and hidden-message checkpoints do not shorten plaintext TTL.

Expired message cleanup:

- message queries inspect `ttl` before filtering expired docs out of the rendered batch.
- if `ttl` expired more than 60 seconds ago, the client batches deletes for already-read docs.
- client delete cost: 1 `FD` per expired doc, plus message-delete rules reads for the batch request.
- native Firestore TTL is the backup path when no client sees the expired doc in time; TTL deletes still count as document deletes.

Smart hidden-message cleanup:

- clients append encrypted `hid` checkpoint control messages after their UI has released read-hidden messages.
- if both participants' hidden checkpoints cover an unsaved received display message, the recipient client may batch delete that message doc.

Control-message compaction:

- clients compact only after decrypting the opaque message stream.
- safe deletes include superseded reactions, duplicate read receipts with the same sender and target, old hidden checkpoints covered by a newer checkpoint from the same sender, and retention setting rows replaced before any display message used them.
- full read-receipt compaction is intentionally avoided because older receipt timestamps are the first-seen clock for `24h after seen` retention.
- if a smart-deleted message is current `lastMsg`, the client clears parent `lastMsg`: 1 `FW`.
- media objects are not deleted by smart message cleanup; unsaved media ages out through the Storage lifecycle rule.

## Delete chat

Code: `functions/user/actions/deletechat.js`.

Steps:

- callable invocation: 1 `FN`.
- reads `profiles/{uid}`: 1 `FR`.
- reads `chats/{chatId}`: 1 `FR`.
- verifies user's chat key is a participant.
- writes parent chat `{ deleting: true, lastMsg: delete }`: 1 `FW`.
- queries all message docs in subcollection:
  - `max(1, M)` `FR`.
- deletes each message doc:
  - `M` `FD`.
- deletes parent chat:
  - 1 `FD`.
- before the callable, the client scans decryptable message docs for saved media stays; after a successful delete, it calls `setMediaSaved(false)` for each collected stay. Media blobs are intentionally kept and unsaved media ages out through Storage lifecycle.
- Admin SDK bypasses rules.

Formula:

- 1 `FN`.
- `2 + max(1, M)` `FR`.
- 1 `FW`.
- `M + 1` `FD`.

## Delete account

Code: `functions/user/actions/deleteaccount.js`.

Steps:

- callable invocation: 1 `FN`.
- reads `profiles/{uid}`: 1 `FR`.
- if chatPK exists:
  - queries `chats where participants array-contains chatPK`: `max(1, C)` `FR`.
  - recursively deletes each chat doc and all message docs.
  - Firestore charges deletes for deleted docs and may do internal reads/listing for recursive enumeration.
- before the callable, the client scans decryptable account chats for saved media stays; after a successful delete, it releases those stays with `setMediaSaved(false)`.
- recursively deletes `users/{uid}`:
  - deletes user doc and subcollections such as `blocked` and `push`.
  - recursive enumeration can add reads/listing.
- queries `walletWebhookEvents where uid == uid`: `max(1, E)` `FR`.
- deletes `E` wallet event docs: `E` `FD`.
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
- queries `walletWebhookRoutes where uid == uid`: `max(1, R)` `FR`.
- deletes `R` route docs.
- deletes Auth user.
- chat media blobs are intentionally kept.

Minimum-ish account with no chats/events/usernames/passkeys/routes still pays query minimums:

- 1 profile read.
- 1 chats query read if chatPK exists.
- 1 wallet events query read.
- 1 usernames query read.
- 1 passkeys query read.
- 1 wallet routes query read.
- deletes for seed/profile/moderation and user recursive tree if docs exist.

## Push device actions

Code:

- `functions/user/actions/push.js`.
- iOS `apps/ios/src/lib/push.js`.
- iOS `apps/ios/src/providers/pushprovider.js`.

### `setPush`

Callable:

- 1 `FN`.

Stale cleanup queries:

- collection group `push where did == did`: at least 1 `FR`.
- collection group `push where nativeToken == nativeToken`: at least 1 `FR` when native token is provided.
- collection group `push where token == token`: at least 1 `FR` when Expo token is provided.
- returned stale docs add reads beyond query minimum.
- deletes stale refs: `S` `FD`.

Device-limit transaction:

- reads current `users/{uid}/push/{did}`: 1 `FR`.
- if current doc does not exist:
  - queries oldest push docs ordered by updatedAt, limit 4.
  - cost is between 1 and 4 `FR`.
  - if limit exceeded, deletes oldest different device: 1 `FD`.
- writes current push doc: 1 `FW`.

Common new APNS-only device, no stale refs:

- 1 `FN`.
- 4 `FR`.
- 1 `FW`.

Common existing APNS/Expo device refresh, no stale refs:

- 1 `FN`.
- 3 `FR`.
- 1 `FW`.

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

- client uploads evidence to `reports/{reporterUid}/{targetUid}/{evidenceId}`: 1 `SA`.
- report evidence rules add no Firestore `RR`.
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
- attaches chat listener for bot chat key:
  - initial `max(1, bot chat count)` `FR`.
  - future changed chats deliver more `FR`.
- session close writes `profiles/{botUid}.active = false`: 1 `FW`.

### User messages a bot

The user's outbound message pays the normal send cost. The bot runtime then pays its own Admin SDK costs:

- bot chat listener receives changed parent chat: 1 `FR`.
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
  - read-receipt and hidden-checkpoint control messages do not update parent chat `lastMsg` and do not trigger push.
- if bot replies with text/request:
  - deterministic message create, with no existence pre-read.
  - writes message doc and parent chat: 2 `FW`.
  - triggers `onChatMessage`: 1 `FN`, `5 + max(1, P_user)` `FR`.
- if bot mirrors attachment:
  - deterministic mirror message preflight before reading media: 1 `FR`.
  - downloads user media: 1 `SB` plus bytes.
  - uploads mirrored media: 1 `SA` plus bytes.
  - sends bot media message as above.
- if bot pays request:
  - deterministic mirrored-request preflight before Spark transfer: 1 `FR`.
  - Spark transfer external.
  - patches user's request: 1 message `FR`, 1 message `FW`, 1 parent chat `FR`, maybe 1 parent chat `FW`.
  - sends bot request/message back.

## Cost hotspots found

1. Control-heavy or mostly hidden chats can force adaptive latest-message listeners and older loads up to the 60-doc cap.
2. `bitcoin/current` updates fan out to every mounted client once per minute.
3. Push registration has query-minimum reads even when no stale docs exist.
4. Peer refresh can read up to 50 profile docs per refresh interval.
5. Account deletion recursively deletes chat/message trees and user subcollections, which is acceptable for rare deletion but expensive for chat-heavy users.
6. Media bytes are mostly user-driven; media warming is disabled, which avoids hidden Storage download costs.
