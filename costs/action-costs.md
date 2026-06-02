# Cost per user action

This file ties the repo-derived server actions in [server-actions.md](server-actions.md) to the Firebase unit costs in [basecosts.md](basecosts.md).

These are gross operation costs before daily/monthly free quotas. [README.md](README.md) applies the common free quotas for the monthly model.

For sustained app-wide messages-per-second costs, use [message-rate-costs.md](message-rate-costs.md).

## Single action costs

| User action | Server actions included | Gross cost |
| --- | --- | ---: |
| Create account, skip avatar | Passkey registration, username, seed, community ack, wallet/chat keys, presence | ~$0.000027 before Auth MAU |
| Create account, upload avatar | Create account + avatar upload and URL lookup | ~$0.000033 before Auth MAU and stored bytes |
| Existing passkey login | Challenge, verify, passkey counter, user doc check | ~$0.000007 before Auth MAU |
| Launch/unlock web app, 10 min | Route guard, seed read, core listeners, blocked query, bitcoin listener, chat list, one warmed chat, presence | ~$0.000040 |
| Launch/unlock iOS app, 10 min | Seed listener, core listeners, blocked query, bitcoin listener, chat list, one warmed chat, presence | ~$0.000039 |
| Open a chat | Adaptive recent message listener targeting 20 post-retention readable messages, no older prefetch | ~$0.000014 normal, up to ~$0.000038 in control-heavy spans |
| Send text message | Message doc, owner chat entry, block-enforcing inbox ping/push callable | ~$0.000011 solo/latest established active push; intermediate queued burst sends are one message write before the latest queued `push` |
| Send payment request | Same server cost as text message | ~$0.000011 solo/latest established active push; intermediate queued burst sends are one message write before the latest queued `push` |
| Send media or long text | Text-message cost plus one Storage upload | ~$0.000016 before stored bytes |
| Send same media to 5 people | One upload reused across five message sends | ~$0.000061 before stored bytes |
| Recipient reads message | Encrypted read receipt action doc | ~$0.000002 |
| React to message | Encrypted reaction action doc | ~$0.000002 |
| Hidden-message checkpoint | Encrypted hidden checkpoint action doc after client UI releases hidden messages | ~$0.000002 |
| Control-message compaction delete | Client batch delete of obsolete encrypted controls after decrypting the stream | ~$0.0000002 to ~$0.000002 per doc |
| Pay a chat request | Spark payment external, then payer-signed `pay_confirm` action doc | ~$0.000002 + Spark cost |
| Save message forever | Owner-owned encrypted saved record | ~$0.000002 |
| Save media forever | Save message forever plus media stay docs and first-save temporary hold metadata | ~$0.000013 |
| Unsave media, final save removed | Deletes stay/aggregate docs and clears temporary hold | ~$0.000007 |
| Client TTL cleanup of expired message | Already-read expired message doc deleted in a client write batch after 60s grace; Firestore TTL is backup | ~$0.0000002 to ~$0.000002 per doc |
| Delete one message | Hard-deletes the source message doc; deleting client cleans matching saved state/media stay | ~$0.0000002, plus unsave cost for saved media |
| Delete chat | Rare `deleteChat` callable deletes caller owner entry/saved records and recursively deletes the opaque chat subtree | depends on message count; roughly one function plus one delete per owner/message doc |
| Submit report, no file | Reads target profile, writes report and aggregate | ~$0.000005 |
| Submit report with evidence file | Report cost plus one evidence upload | ~$0.000010 + bytes |
| Search username, 10 results | Reads 10 profile docs | ~$0.000006 |
| Register new push device | Current device read, owner-index reads/writes, oldest-device query, push doc write | ~$0.000011 first write; unchanged refresh is one read |
| BTC scheduler | One scheduled function and one Firestore write every minute | ~$0.0032/day app-wide |
| BTC listener fanout | Client reads `bitcoin/current` initially and each minute | ~$0.0000066 per mounted 10 min client |

## Daily active user bundle

Using [assumptions.md](assumptions.md), one normal daily active user costs:

| Daily bucket | Gross cost |
| --- | ---: |
| Launch/unlock, 10 min | ~$0.000040 |
| Open 3 chats | ~$0.000042 |
| Send 10 messages | ~$0.000112 |
| Read 10 messages | ~$0.000024 |
| React twice | ~$0.000005 |
| Send 1 media item | ~$0.000016 before stored bytes |
| Save 10% of sent messages/media | ~$0.000010 + retained storage growth |
| Search once | ~$0.000006 |
| **Total immediate daily active user ops** | **~$0.00024/day + stored-byte run-rate** |

Equivalent operation bundle per daily active user:

- about 205 Firestore read-equivalent operations,
- about 24 Firestore writes,
- about 11 function invocations,
- about 1 Storage Class A operation,
- about 1.1 saved message docs and 0.1 saved media objects retained forever,
- no routine deletes except TTL cleanup when expired message docs are encountered.
