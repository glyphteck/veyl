# User behavior assumptions

These assumptions turn per-action server costs into a monthly operating model. The executable defaults live in [model.mjs](model.mjs) so assumptions can be changed in one place.

## Model defaults

| Variable | Assumption |
| --- | ---: |
| Days per month | 30 |
| Monthly active users | 3x DAU |
| Paid Auth MAU price after free quota | $0.0055 |
| Auth free quota | 50,000 MAU/month |
| Average media object | 5 MiB |
| Average avatar object | 25 KiB |
| Avatar upload rate | 90% of new accounts |
| Saved text/payment messages | 10% |
| Saved media messages | 10% |
| Saved message document size | 2 KiB |
| Routine unsaved media live set | 21 days |
| Retained saved-history age in monthly table | 360 days |
| Media download egress, function compute, Spark, moderation labor | $0 in this model |

## Normal daily active user

One daily active user is assumed to do this per day:

| Behavior | Assumption |
| --- | ---: |
| App launches/unlocks | 1 session |
| Mounted session length | 10 minutes |
| Chats opened | 3 |
| Text or payment-request messages sent | 10 |
| Messages read, causing read receipts | 10 |
| Reactions sent | 2 |
| Media or long-text messages sent | 1 averaging 5 MiB |
| Messages saved forever | 10% of sent messages |
| Media messages saved forever | 10% of sent media messages |
| Username/profile searches | 1 search returning 10 profiles |
| Push registration refreshes | 0 normal daily cost; only when token/device state changes |

This is an active-user model, not a registered-user model. Use DAU, not total accounts.

## New account

One new account is assumed to:

- create an account,
- complete onboarding,
- upload an avatar 90% of the time, averaging 25 KiB.

Daily active behavior is modeled separately in the DAU table. Avatar upload is weighted separately because it adds Storage bytes.

## Saved retention

The retained-data model assumes 10% of sent messages are saved forever. That 10% is applied separately to normal text/payment messages and media/long-text messages so media retention can be estimated from a per-DAU-day storage addition.

For rough Firestore retained-data math, a saved message document is estimated at 2 KiB including document and index overhead. This is intentionally conservative until real billing/export measurements exist.

For media retained-data math, the default planning value is one 5 MiB encrypted media object per DAU-day. With 10% saved forever, each DAU-day permanently adds about 0.1 saved media object, or 0.5 MiB of saved media storage. The 21-day live media set before lifecycle deletion is modeled from the full one media object per DAU-day.

If the average media object changes, media stored-byte costs scale linearly.

## Scale points

Monthly totals are shown for:

- 100 daily active users,
- 1,000 daily active users,
- 10,000 daily active users,
- 100,000 daily active users,
- 1,000,000 daily active users.

## Zero-dollar defaults

The monthly table assumes `$0` for media download egress, Cloud Functions CPU/memory duration beyond invocation charges, Firestore index-entry reads from Query Explain, Spark wallet/payment network costs, and moderation labor. These are zero-default variables in [model.mjs](model.mjs).
