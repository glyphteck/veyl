# Cost per user action

This file ties the repo-derived server actions in [server-actions.md](server-actions.md) to the Firebase unit costs in [basecosts.md](basecosts.md).

These are gross operation costs before daily/monthly free quotas. [README.md](README.md) applies the common free quotas for the monthly model.

## Single action costs

| User action | Server actions included | Gross cost |
| --- | --- | ---: |
| Create account, skip avatar | Passkey registration, username, seed, community ack, wallet/chat keys, presence | ~$0.000027 + Auth MAU |
| Create account, upload avatar | Create account + avatar upload and URL lookup | ~$0.000033 + Auth MAU + bytes |
| Existing passkey login | Challenge, verify, passkey counter, user doc check | ~$0.000007 + Auth MAU |
| Launch/unlock web app, 10 min | Route guard, seed read, core listeners, blocked query, bitcoin listener, chat list, two warmed chats, presence | ~$0.000116 |
| Launch/unlock iOS app, 10 min | Seed listener, core listeners, blocked query, bitcoin listener, chat list, two warmed chats, presence | ~$0.000115 |
| Open a chat | Recent message listener plus one older prefetch | ~$0.000158 |
| Send text message | Message write, parent chat update, rules reads, push-trigger function and reads | ~$0.000010 |
| Send payment request | Same server cost as text message | ~$0.000010 |
| Send media or long text | Text-message cost plus one Storage upload | ~$0.000015 + bytes |
| Send same media to 5 people | One upload reused across five message sends | ~$0.000055 + bytes |
| Recipient reads message | Read receipt write plus full push-trigger resolver | ~$0.000008 |
| React to message | Reaction write plus full push-trigger resolver | ~$0.000008 |
| Pay a chat request | Spark payment external, then request-message patch | ~$0.000008 + Spark cost |
| Save media forever | Media stay docs and first-save temporary hold metadata | ~$0.000010 |
| Unsave media, final save removed | Deletes stay/aggregate docs and clears temporary hold | ~$0.000007 |
| Delete one message | Reads chat/message, deletes message, maybe updates chat preview | ~$0.000003 to ~$0.000006 |
| Delete chat with 100 messages | Reads profile/chat/messages, marks deleting, deletes 100 messages and parent chat | ~$0.000084 |
| Submit report, no file | Reads target profile, writes report and aggregate | ~$0.000005 |
| Submit report with evidence file | Report cost plus one evidence upload | ~$0.000010 + bytes |
| Search username, 10 results | Reads 10 profile docs | ~$0.000006 |
| Register new push device | Duplicate token checks, current device read, oldest-device query, push doc write | ~$0.000005 |
| BTC scheduler | One scheduled function and one Firestore write every minute | ~$0.0032/day app-wide |
| BTC listener fanout | Client reads `bitcoin/current` initially and each minute | ~$0.0000066 per mounted 10 min client |

## Daily active user bundle

Using [assumptions.md](assumptions.md), one normal daily active user costs:

| Daily bucket | Gross cost |
| --- | ---: |
| Launch/unlock, 10 min | ~$0.000115 |
| Open 3 chats | ~$0.000473 |
| Send 10 messages | ~$0.000100 |
| Read 10 messages | ~$0.000082 |
| React twice | ~$0.000016 |
| Send 1 media item | ~$0.000015 + bytes |
| Search once | ~$0.000006 |
| **Total daily active user** | **~$0.00081/day + media bytes** |

Equivalent operation bundle per daily active user:

- about 1,219 Firestore read-equivalent operations,
- about 35 Firestore writes,
- about 23 function invocations,
- about 1 Storage Class A operation,
- no deletes in the normal daily flow.
