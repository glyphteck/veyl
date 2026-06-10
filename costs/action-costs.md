# Cost per user action

This file ties the repo-derived server actions in [server-actions.md](server-actions.md) to the Firebase unit costs in [basecosts.md](basecosts.md).

These are gross operation costs before daily/monthly free quotas. [README.md](README.md) applies the common free quotas for the monthly model.

For sustained app-wide messages-per-second costs, use [message-rate-costs.md](message-rate-costs.md).

## Single action costs

| User action | Server actions included | Gross cost |
| --- | --- | ---: |
| Create account, skip avatar | Passkey registration, username, seed, community ack, wallet/chat keys, presence | ~$0.000027 |
| Create account, upload avatar | Create account + avatar upload and URL lookup | ~$0.000033 before stored bytes |
| Existing passkey login | Challenge, verify, passkey counter, user doc check | ~$0.000007 |
| Launch/unlock web app, 10 min | Route guard, seed read, core listeners, blocked query, bitcoin listener, chat list, one warmed chat, presence | ~$0.000040 |
| Launch/unlock iOS app, 10 min | Seed listener, core listeners, blocked query, bitcoin listener, chat list, one warmed chat, presence | ~$0.000039 |
| Open a chat | Adaptive recent message listener targeting 20 post-retention readable messages plus chat deletion-gate rules read, no older prefetch | ~$0.000015 normal, up to ~$0.000039 in control-heavy spans |
| Send text message | Message doc, owner chat entry, chat deletion-gate rules read, block-enforcing inbox ping/push callable | ~$0.000011 solo/latest established delivery-only; active OS notification adds 1 sender-profile read and still rounds to ~$0.000011; first send to a peer without an active chat id adds `openChatLink` |
| Send payment request | Same server cost as text message | same as text message |
| Send media or long text | Text-message cost plus direct chat-media Storage upload and one Storage-rules deletion-gate read | ~$0.000017 before stored bytes on active-notification path |
| Share same media to 5 people | One signed shared upload reused across five established message sends | ~$0.000072 before stored bytes on active-notification paths |
| Recipient reads message | Encrypted read receipt action doc plus chat deletion-gate rules read; loaded clients can derive "saw your message" previews from the stream | ~$0.000002 |
| React to message | Encrypted reaction action doc plus chat deletion-gate rules read; loaded clients can derive "liked your message" previews from the stream | ~$0.000002 |
| Hidden-message checkpoint | Encrypted hidden checkpoint action doc plus chat deletion-gate rules read after client UI releases hidden messages | ~$0.000002 |
| Control-message compaction delete | Client batch delete of obsolete encrypted controls after decrypting the stream | ~$0.0000002 to ~$0.000002 per doc |
| Pay a chat request | Spark payment external, then payer-signed `pay_confirm` action doc | ~$0.000002 + Spark cost |
| Save message forever | Direct message `ttl` update sets the shared message doc to `null` | ~$0.000002 |
| Save media forever | Save message forever plus one Storage temporary-hold metadata update | ~$0.000013 |
| Unsave media | Direct message `ttl` update restores a normal TTL and clears the Storage temporary hold | ~$0.000013 |
| Client TTL cleanup of expired message | Already-read expired message doc deleted in a client write batch after 60s grace; Firestore TTL is backup | ~$0.0000002 to ~$0.000002 per doc |
| Delete one text message | Direct source message doc delete plus chat deletion-gate rules read | ~$0.000001 |
| Delete one media message | Text-message hard delete plus direct Storage object delete | ~$0.000001 |
| Delete chat | Rare `deleteChat` callable tags the chat deleted, wipes caller owner entry, then best-effort cleanup plus worker cleanup drains media/messages in chunks | depends on message count; roughly one function plus cleanup deletes |
| Submit report, no file | Rate limit, reads target profile, writes report and aggregate | ~$0.000009 |
| Submit report with evidence file | Report cost plus evidence reservation and upload | ~$0.000027 + bytes |
| Search username, 10 results | Reads 10 profile docs | ~$0.000006 |
| Register new push device | Current device read, owner-index reads/writes, oldest-device query, push doc write | ~$0.000011 first write; unchanged refresh is one read |
| BTC scheduler | One scheduled function and one Firestore write every minute | ~$0.0032/day app-wide |
| BTC listener fanout | Client reads `bitcoin/current` initially and each minute | ~$0.0000066 per mounted 10 min client |

## Daily active user bundle

Using [assumptions.md](assumptions.md), one normal daily active user costs:

| Daily bucket | Gross cost |
| --- | ---: |
| Launch/unlock, 10 min | ~$0.000040 |
| Open 3 chats | ~$0.000045 |
| Send 24 text/payment messages | ~$0.000269 on active-notification paths, ~$0.000254 delivery-only |
| Read 25 messages | ~$0.000060 |
| React twice | ~$0.000005 |
| Send 1 media item | ~$0.000017 before stored bytes |
| Save 10% of sent messages/media | ~$0.000007 + retained storage growth |
| Search once | ~$0.000006 |
| **Total immediate daily active user ops** | **~$0.00046/day + stored-byte run-rate** |

Equivalent operation bundle per daily active user:

- about 325 Firestore read-equivalent operations,
- about 132 Firestore writes,
- about 26 function invocations,
- about 1 Storage Class A operation,
- about 2.5 saved message docs and 0.1 saved media objects retained forever,
- no routine deletes except TTL cleanup when expired message docs are encountered.
