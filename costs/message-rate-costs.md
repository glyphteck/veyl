# Message-rate cost model

This file answers app-wide sustained throughput questions such as "what does 1 visible message per second for one month cost?" The executable source of truth is [model.mjs](model.mjs); this file explains the table outputs.

The default DAU model in [assumptions.md](assumptions.md) uses 25 visible sends per active user/day. At 1M DAU, that is about 289 visible messages/s before read-receipt control messages.

## Scope

A visible message send is the normal encrypted chat send path from [server-actions.md](server-actions.md). It includes:

- 4 Firestore writes for a solo/latest established visible send: global message doc, sender owner chat entry, rate-limit bucket, and recipient inbox ping.
- 6 Firestore reads on the active OS-notification path with one receiver push route: push-callable rate-limit bucket, sender chat-ban check, recipient block check, receiver push-doc query minimum, sender profile username read, and the Firestore-rules chat deletion gate on message create.
- 1 Cloud Functions invocation for the block-enforcing `push` callable.

This rate model excludes media upload/storage/download bytes, live listener fanout, stale push token cleanup writes, message-maintenance compaction/autodelete deletes, Spark/payment costs, saved-message retention, Cloud Functions CPU/memory duration, outbound network, and moderation labor.

Read receipts are optional in the table because a sent message and a later recipient read are separate encrypted events. If every sent message is read, add one read receipt per visible message: 1 Firestore rules read plus 1 Firestore write.

This is billing math only. Sustained high MPS spread across many chats is different from high MPS concentrated in one chat because the send queue coalesces entry/ping updates: only the latest queued visible send per chat writes the owner entry and calls `push`.

## Formula

The model uses a 30-day month:

```txt
seconds_per_month = 30 * 24 * 60 * 60 = 2,592,000
messages_per_month = messages_per_second * 2,592,000

visible_send_gross =
  messages_per_month * (
    6 Firestore reads * $0.0000006
    + 4 Firestore writes * $0.0000018
    + 1 function invocation * $0.0000004
  )
```

That makes one active-notification established visible send about `$0.0000112` before free quotas. If every sent message emits a read receipt, the gross cost becomes about `$0.0000136` per message.

If the receiver has no active push route, the callable still writes the inbox ping but stops after the private empty push-doc query minimum. That path is 5 read-equivalent operations because it does not read the sender profile username.

Established-chat bursts coalesce entry/ping updates while the queue is not empty. Intermediate queued sends write only the encrypted message doc; the latest queued send for that chat pays the solo/latest visible-send path above.

The "paid/month" columns below subtract the common Firebase free quotas from [basecosts.md](basecosts.md) as if this message stream were the only app workload. The "gross/month" column is the better incremental number when adding message traffic on top of a loaded DAU model that already consumes those free quotas.

## Visible send-only rates

| Sustained visible sends | Messages/month | Gross/month | Paid reads/month | Paid writes/month | Paid functions/month | Paid/month |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.01 msg/s | 25,920 | ~$0.29 | ~$0 | ~$0 | ~$0 | ~$0 |
| 0.1 msg/s | 259,200 | ~$2.90 | ~$0.03 | ~$0.79 | ~$0 | ~$0.82 |
| 1 msg/s | 2,592,000 | ~$29.03 | ~$8.43 | ~$17.58 | ~$0.24 | ~$26.25 |
| 10 msg/s | 25,920,000 | ~$290 | ~$92 | ~$186 | ~$10 | ~$288 |
| 100 msg/s | 259,200,000 | ~$2,903 | ~$932 | ~$1,865 | ~$103 | ~$2,900 |
| 1,000 msg/s | 2,592,000,000 | ~$29,030 | ~$9,330 | ~$18,661 | ~$1,036 | ~$29,028 |
| 10,000 msg/s | 25,920,000,000 | ~$290,304 | ~$93,311 | ~$186,623 | ~$10,367 | ~$290,301 |

## Visible sends plus one read receipt each

| Sustained visible sends | Messages/month | Gross/month | Paid/month | Paid add-on over send-only |
| ---: | ---: | ---: | ---: | ---: |
| 0.01 msg/s | 25,920 | ~$0.35 | ~$0 | ~$0 |
| 0.1 msg/s | 259,200 | ~$3.53 | ~$1.44 | ~$0.62 |
| 1 msg/s | 2,592,000 | ~$35.25 | ~$32.47 | ~$6.22 |
| 10 msg/s | 25,920,000 | ~$353 | ~$350 | ~$62 |
| 100 msg/s | 259,200,000 | ~$3,525 | ~$3,522 | ~$622 |
| 1,000 msg/s | 2,592,000,000 | ~$35,251 | ~$35,248 | ~$6,221 |
| 10,000 msg/s | 25,920,000,000 | ~$352,512 | ~$352,509 | ~$62,208 |

## Variables to change

Run the executable model directly for a single rate:

```bash
MESSAGES_PER_SECOND=10 bun costs/model.mjs
MESSAGES_PER_SECOND=10 INCLUDE_READ_RECEIPTS=1 bun costs/model.mjs
```

The message-rate inputs are:

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `MESSAGES_PER_SECOND` | unset | Sustained visible sends per second for the message-rate CLI output. |
| `INCLUDE_READ_RECEIPTS` | `false` | Include one read receipt per visible message. |
| `DAYS_PER_MONTH` | `30` | Month length used for rate conversion. |
| `MESSAGE_SEND_READS` | `6` | Firestore reads per solo/latest established active-notification visible send through the block-enforcing push callable plus chat deletion gate. Use `5` for no-active-route delivery-only traffic. |
| `MESSAGE_SEND_WRITES` | `4` | Firestore writes per solo/latest visible send through the block-enforcing push callable. |
| `MESSAGE_SEND_FUNCTIONS` | `1` | Function invocations per visible send. |
| `READ_RECEIPT_READS` | `1` | Firestore rules chat deletion gate read per read receipt. |
| `READ_RECEIPT_WRITES` | `1` | Firestore writes per read receipt. |

If a receiver has more than one active push device document, add one Firestore read per extra push document per `push` call. The same adjustment applies to extra live listener copies: each listener delivery is another Firestore read. At 1 msg/s, one additional read per visible message is about `$1.56/month` gross before free quotas.
