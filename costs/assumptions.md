# Cost model assumptions

These assumptions turn repo-derived action costs into monthly planning numbers. The executable defaults live in [model.mjs](model.mjs).

## Scale variables

| Variable | Default | Meaning |
| --- | ---: | --- |
| `DAU` | 1,000,000 in the CLI | Daily active users, not registered accounts. |
| `DAYS_PER_MONTH` | 30 | Month length used for monthly totals and message-rate math. |
| `MAU_PER_DAU` | 3 | Monthly active users are modeled as 3x DAU. |
| Auth free quota | 50,000 MAU/month | Applied before the `$0.0055` paid Auth MAU rate. |
| `RETAINED_SAVED_DAYS` | 360 | Retained saved-history age used for saved media and saved message-doc storage. |

The README's 100k DAU table means 100,000 daily active users and 300,000 monthly active users.

## Normal daily active user

One DAU-day is modeled as:

| Behavior | Default |
| --- | ---: |
| App launches/unlocks | 1 session |
| Mounted session length | 10 minutes |
| Chats opened | 3 |
| Text or payment-request messages sent | 10 |
| Messages read, causing read receipts | 10 |
| Reactions sent | 2 |
| Media or long-text messages sent | 1 |
| Username/profile searches | 1 search returning about 10 profiles |
| Push registration refreshes | 0 normal daily cost; only when token/device state changes |

That bundle is about 260 Firestore read-equivalent ops, 35 Firestore writes, 11 function invocations, and 1 Storage Class A operation per DAU-day.

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

Each DAU-day permanently adds about:

- 1.1 saved message docs,
- 2.2 KiB of saved Firestore message-doc storage,
- 0.5 MiB of saved media storage.

At sustained 100k DAU, one extra retained saved-history year adds about `$365/month` to the future monthly run-rate. The saved-media bytes dominate that buildup.

## New account

One new account is assumed to:

- create a passkey account,
- complete username/vault onboarding,
- upload an avatar 90% of the time.

Daily active behavior is modeled separately. Paid Auth MAU is a monthly active-user charge, not a one-time lifetime signup fee.

## Zero-dollar defaults

The monthly table intentionally leaves these as `$0` until real usage or vendor costs are known:

| Environment variable | Default |
| --- | ---: |
| `MEDIA_DOWNLOAD_GIB_PER_DAU_MONTH` | 0 |
| `MEDIA_DOWNLOAD_GIB_COST` | 0 |
| `FUNCTION_COMPUTE_COST_PER_DAU_MONTH` | 0 |
| `SPARK_COST_PER_DAU_MONTH` | 0 |
| `MODERATION_COST_MONTH` | 0 |

Those zero defaults keep the model focused on Firebase operations, stored bytes, and Auth MAU. Change them in the environment or in [model.mjs](model.mjs) when those costs become known.

## Message-rate variables

Sustained app-wide throughput is separate from DAU scale. See [message-rate-costs.md](message-rate-costs.md).

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `MESSAGES_PER_SECOND` | unset | Enables the message-rate CLI output. |
| `INCLUDE_READ_RECEIPTS` | false | Adds one read receipt per visible send. |
| `MESSAGE_SEND_READS` | 9 | Firestore reads per active-push visible send. |
| `MESSAGE_SEND_WRITES` | 2 | Firestore writes per visible send. |
| `MESSAGE_SEND_FUNCTIONS` | 1 | Function invocations per visible send. |
| `READ_RECEIPT_READS` | 3 | Firestore reads per read receipt. |
| `READ_RECEIPT_WRITES` | 1 | Firestore writes per read receipt. |
