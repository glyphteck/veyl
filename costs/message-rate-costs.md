# Message-rate cost model

This file answers app-wide sustained throughput questions such as "what does 1 visible message per second for one month cost?" The executable source of truth is [model.mjs](model.mjs); this file explains the table outputs.

## Scope

A visible message send is the normal encrypted chat send path from [server-actions.md](server-actions.md). It includes:

- 2 Firestore writes: one message document and one parent chat preview update.
- 9 Firestore reads on the active-push path: about 3 rules reads plus 6 trigger reads when the receiver has one active push device document.
- 1 Cloud Functions invocation for the parent chat push resolver.

This rate model excludes media upload/storage/download bytes, live listener fanout, stale push token cleanup writes, Spark/payment costs, Auth MAU, saved-message retention, Cloud Functions CPU/memory duration, outbound network, and moderation labor.

Read receipts are optional in the table because a sent message and a later recipient read are separate encrypted events. If every sent message is read, add one read receipt per visible message: 3 Firestore reads and 1 Firestore write.

This is billing math only. Sustained high MPS spread across many chats is different from high MPS concentrated in one chat because every visible send updates the parent `chats/{chatId}` document.

## Formula

The model uses a 30-day month:

```txt
seconds_per_month = 30 * 24 * 60 * 60 = 2,592,000
messages_per_month = messages_per_second * 2,592,000

visible_send_gross =
  messages_per_month * (
    9 Firestore reads * $0.0000006
    + 2 Firestore writes * $0.0000018
    + 1 function invocation * $0.0000004
  )
```

That makes one active-push visible send about `$0.0000094` before free quotas. If every sent message emits a read receipt, the gross cost becomes about `$0.0000130` per message.

If the receiver has no active push route, the push trigger now stops after one route-doc read. That path is about 4 Firestore reads, 2 writes, and 1 function invocation, or about `$0.0000064` gross per message.

Established-chat bursts also coalesce parent chat updates at queue drain. Queued sends write message docs first, so each pre-sync send is about 3 Firestore reads, 1 write, and no push function, or about `$0.0000036` gross. When the queue clears, the latest parent chat row is synced once per affected chat and pays the active-push or no-active-push parent-update cost above.

The "paid/month" columns below subtract the common Firebase free quotas from [basecosts.md](basecosts.md) as if this message stream were the only app workload. The "gross/month" column is the better incremental number when adding message traffic on top of a loaded DAU model that already consumes those free quotas.

## Visible send-only rates

| Sustained visible sends | Messages/month | Gross/month | Paid reads/month | Paid writes/month | Paid functions/month | Paid/month |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.01 msg/s | 25,920 | ~$0.24 | ~$0 | ~$0 | ~$0 | ~$0 |
| 0.1 msg/s | 259,200 | ~$2.44 | ~$0.50 | ~$0 | ~$0 | ~$0.50 |
| 1 msg/s | 2,592,000 | ~$24.36 | ~$13.10 | ~$8.25 | ~$0.24 | ~$21.58 |
| 10 msg/s | 25,920,000 | ~$244 | ~$139 | ~$92 | ~$10 | ~$241 |
| 100 msg/s | 259,200,000 | ~$2,436 | ~$1,399 | ~$932 | ~$103 | ~$2,434 |
| 1,000 msg/s | 2,592,000,000 | ~$24,365 | ~$13,996 | ~$9,330 | ~$1,036 | ~$24,362 |
| 10,000 msg/s | 25,920,000,000 | ~$243,648 | ~$139,967 | ~$93,311 | ~$10,367 | ~$243,645 |

## Visible sends plus one read receipt each

| Sustained visible sends | Messages/month | Gross/month | Paid/month | Paid add-on over send-only |
| ---: | ---: | ---: | ---: | ---: |
| 0.01 msg/s | 25,920 | ~$0.34 | ~$0 | ~$0 |
| 0.1 msg/s | 259,200 | ~$3.37 | ~$1.29 | ~$0.79 |
| 1 msg/s | 2,592,000 | ~$33.70 | ~$30.92 | ~$9.33 |
| 10 msg/s | 25,920,000 | ~$337 | ~$334 | ~$93 |
| 100 msg/s | 259,200,000 | ~$3,370 | ~$3,367 | ~$933 |
| 1,000 msg/s | 2,592,000,000 | ~$33,696 | ~$33,693 | ~$9,331 |
| 10,000 msg/s | 25,920,000,000 | ~$336,960 | ~$336,957 | ~$93,312 |

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
| `MESSAGE_SEND_READS` | `9` | Firestore reads per visible send. |
| `MESSAGE_SEND_WRITES` | `2` | Firestore writes per visible send. |
| `MESSAGE_SEND_FUNCTIONS` | `1` | Function invocations per visible send. |
| `READ_RECEIPT_READS` | `3` | Firestore reads per read receipt. |
| `READ_RECEIPT_WRITES` | `1` | Firestore writes per read receipt. |

If a receiver has more than one push device document, add one Firestore read per extra push document per parent chat update. The same adjustment applies to extra live listener copies: each listener delivery is another Firestore read. At 1 msg/s, one additional read per visible message is about `$1.56/month` gross before free quotas.
