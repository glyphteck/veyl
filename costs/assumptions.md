# Cost model assumptions

These assumptions turn repo-derived action costs into monthly planning numbers. The executable defaults live in [model.mjs](model.mjs).

## Scale variables

| Variable | Default | Meaning |
| --- | ---: | --- |
| `DAU` | 1,000,000 in the CLI | Daily active users, not registered accounts. |
| `DAYS_PER_MONTH` | 30 | Month length used for monthly totals and message-rate math. |
| `RETAINED_SAVED_DAYS` | 360 | Retained saved-history age used for saved media and saved message-doc storage. |

The README's 100k DAU table means 100,000 daily active users under the normal daily active-user bundle.

## Normal daily active user

One active user over one day is modeled as:

| Behavior | Default |
| --- | ---: |
| App launches/unlocks | 1 session |
| Mounted session length | 10 minutes |
| Chats opened | 3 |
| Text or payment-request messages sent | 24 |
| Messages read, causing read receipts | 25 |
| Reactions sent | 2 |
| Media or long-text messages sent | 1 |
| Wallet transactions | 0.1 |
| Username/profile searches | 1 search returning about 10 profiles |
| Push registration refreshes | 0 normal daily cost; only when token/device state changes |

That bundle is about 325 Firestore read-equivalent ops, 132 Firestore writes, 26 function invocations, and 1 Storage Class A operation per active user/day. The default send cost assumes active OS-notification routes; no-active-route or bot-heavy traffic is one read cheaper per visible send. Media or long-text sends add one direct Storage upload and one Storage-rules deletion-gate read. At 1M DAU, the default bundle implies about 289 visible messages/s and 1.2 wallet tx/s.

The 25 visible-send default is a neutral planning midpoint. It is lower than WhatsApp-heavy young-adult device logs, close to WhatsApp's broad platform-per-user scale after accounting for the difference between monthly users, daily users, and delivered/group messages, and higher than population-wide SMS/MMS use. The model counts user-generated visible sends, not received delivery fanout.

Wallet transactions are expected Spark/network throughput. `0.1` wallet tx per active user/day is between Zelle's 2024 P2P account-normalized rate and PayPal's broader annual payment-transactions-per-active-account metric. The Firebase model only prices Firebase operations by default; Spark vendor and network costs stay in zero-dollar extras until real rates are known.

Behavior overrides:

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `TEXT_MESSAGES_PER_ACTIVE_USER_DAY` | 24 | Text or payment-request visible sends per active user/day. |
| `MEDIA_MESSAGES_PER_ACTIVE_USER_DAY` | 1 | Media or long-text visible sends per active user/day. |
| `READ_RECEIPTS_PER_ACTIVE_USER_DAY` | 25 | Read-receipt control messages per active user/day. |
| `REACTIONS_PER_ACTIVE_USER_DAY` | 2 | Reaction control messages per active user/day. |
| `WALLET_TXS_PER_ACTIVE_USER_DAY` | 0.1 | Expected wallet transactions per active user/day. |

Real-world anchors:

- [WhatsApp's public scale](https://techcrunch.com/2020/10/29/whatsapp-is-now-delivering-roughly-100-billion-messages-a-day/) has been around 100 billion messages/day, with [more than 3 billion monthly users](https://techcrunch.com/2025/05/01/whatsapp-now-has-more-than-3-billion-users/) reported later; this is useful for scale, but it does not directly equal user-generated visible sends per active user/day.
- A [WhatsApp phone-log study](https://www.demographic-research.org/volumes/vol39/22/39-22.pdf) of young adults found about 38 sent and 107 received messages per day, which is too engaged to use as the broad default by itself.
- [Pew's SMS study](https://www.pewresearch.org/short-reads/2011/09/21/americans-and-text-messaging/) found text users averaged 41.5 sent-or-received texts/day, while the median was 10/day.
- [CTIA's 2024 survey](https://api.ctia.org/wp-content/uploads/2024/09/2024-Annual-Survey.pdf) reported 2.1 trillion US SMS/MMS messages in 2023, about 67,000 messages/s population-wide.
- [Zelle reported](https://www.zelle.com/press-releases/zelle-shatters-records-1-trillion-sent-single-year) 3.6 billion 2024 transactions across 151 million enrolled accounts; [PayPal reported](https://www.sec.gov/Archives/edgar/data/1633917/000163391725000019/pypl-20241231.htm) 60.6 annual payment transactions per active account in 2024.

## Media and retention variables

| Variable | Default | Meaning |
| --- | ---: | --- |
| `MEDIA_MIB` | 5 MiB | Average encrypted media or long-text object size. |
| `SAVED_TEXT_RATE` | 10% | Share of sent text/payment messages saved forever. |
| `SAVED_MEDIA_RATE` | 10% | Share of sent media messages saved forever. |
| Saved message doc size | 2 KiB | Planning size for each retained Firestore message doc including overhead. |
| Routine unsaved media live set | 21 days | Unsaved media storage before lifecycle deletion catches up. |
| `AVATAR_KIB` | 25 KiB | Average avatar object size. |
| `AVATAR_UPLOAD_RATE` | 90% | Share of new accounts that upload an avatar. |

Each active user over one day permanently adds about:

- 2.5 saved message docs,
- 5 KiB of saved Firestore message-doc storage,
- 0.5 MiB of saved media storage.

At sustained 100k DAU, one extra retained saved-history year adds about `$382/month` to the future monthly run-rate. The saved-media bytes dominate that buildup.

## New account

One new account is assumed to:

- create a passkey account,
- complete username/vault onboarding,
- upload an avatar 90% of the time.

Daily active behavior is modeled separately.

## Zero-dollar defaults

The monthly table intentionally leaves these as `$0` until real usage or vendor costs are known:

| Environment variable | Default |
| --- | ---: |
| `MEDIA_DOWNLOAD_GIB_PER_ACTIVE_USER_MONTH` | 0 |
| `MEDIA_DOWNLOAD_GIB_COST` | 0 |
| `FUNCTION_COMPUTE_COST_PER_ACTIVE_USER_MONTH` | 0 |
| `SPARK_COST_PER_ACTIVE_USER_MONTH` | 0 |
| `MODERATION_COST_MONTH` | 0 |

Those zero defaults keep the model focused on Firebase operations and stored bytes. Change them in the environment or in [model.mjs](model.mjs) when those costs become known.

## Message-rate variables

Sustained app-wide throughput is separate from DAU scale. See [message-rate-costs.md](message-rate-costs.md).

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `MESSAGES_PER_SECOND` | unset | Enables the message-rate CLI output. |
| `INCLUDE_READ_RECEIPTS` | false | Adds one read receipt per visible send. |
| `MESSAGE_SEND_READS` | 6 | Firestore reads per solo established active-notification visible send through the block-enforcing push callable plus the chat deletion gate in Firestore rules. Use `5` for no-active-route delivery-only traffic. |
| `MESSAGE_SEND_WRITES` | 4 | Firestore writes per solo visible send through the block-enforcing push callable. |
| `MESSAGE_SEND_FUNCTIONS` | 1 | Function invocations per visible send. |
| `MEDIA_STORAGE_RULE_READS` | 1 | Storage-rules chat deletion-gate reads per direct chat-media or long-text upload. |
| `READ_RECEIPT_READS` | 1 | Firestore rules chat deletion gate read per read receipt. |
| `READ_RECEIPT_WRITES` | 1 | Firestore writes per read receipt. |
