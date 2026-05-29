# User behavior assumptions

These assumptions turn per-action server costs into a monthly operating model. They are intentionally plain and adjustable.

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
| Media or long-text messages sent | 1 |
| Username/profile searches | 1 search returning 10 profiles |
| Push registration refreshes | 0 normal daily cost; only when token/device state changes |

This is an active-user model, not a registered-user model. Use DAU, not total accounts.

## New user first day

One new user is assumed to:

- create an account,
- complete onboarding,
- unlock once,
- then behave like one normal daily active user for the rest of the day.

Avatar upload is modeled separately because it adds Storage bytes.

## Scale points

Monthly totals are shown for:

- 100 daily active users,
- 1,000 daily active users,
- 10,000 daily active users,
- 100,000 daily active users,
- 1,000,000 daily active users.

## Excluded or variable costs

These are called out in [README.md](README.md), but not included in the base monthly table:

- media stored bytes and download egress,
- Cloud Functions CPU/memory duration,
- Firestore index-entry reads from Query Explain,
- paid Auth MAU unless Identity Platform billing applies,
- Spark wallet/payment network costs.
