# Veyl monthly cost report

## Summary

Under the default usage assumptions, one daily active user costs about:

**$0.00081/day in Firebase operations, before media bytes, function compute time, and possible paid Auth MAU.**

That number is dominated by reads from chat opening, chat warming, read receipts, and the bitcoin listener. Account creation is effectively negligible compared with ongoing daily use.

## Assumed daily active user

One daily active user is assumed to:

- launch/unlock once for a 10 minute mounted session,
- open 3 chats,
- send 10 text or payment-request messages,
- read 10 messages, causing read receipts,
- react to 2 messages,
- send 1 media or long-text message,
- run 1 username/profile search returning about 10 profiles.

## Cost per daily active user

| Daily activity | Expected Firebase ops cost |
| --- | ---: |
| Launch/unlock, 10 min | ~$0.000115 |
| Open 3 chats | ~$0.000473 |
| Send 10 messages | ~$0.000100 |
| Read 10 messages | ~$0.000082 |
| React twice | ~$0.000016 |
| Send 1 media item | ~$0.000015 + bytes |
| Search once | ~$0.000006 |
| **Total per daily active user** | **~$0.00081/day + media bytes** |

## Monthly cost by user base

This table uses daily active users, not registered accounts. It includes the fixed BTC scheduler and applies the common Firebase free quotas from [basecosts.md](basecosts.md).

| Daily active users | Gross ops cost/day before free quotas | Estimated paid ops cost/day after free quotas | Estimated paid ops cost/month |
| ---: | ---: | ---: | ---: |
| 100 | ~$0.084 | ~$0.044 | ~$1.31 |
| 1,000 | ~$0.81 | ~$0.74 | ~$22.08 |
| 10,000 | ~$8.09 | ~$8.00 | ~$240 |
| 100,000 | ~$80.86 | ~$80.77 | ~$2,423 |
| 1,000,000 | ~$808.60 | ~$808.51 | ~$24,255 |

## One-time new-user costs

| One-time flow | Expected Firebase ops cost |
| --- | ---: |
| Create account, skip avatar | ~$0.000027 + Auth MAU |
| Create account, upload avatar | ~$0.000033 + Auth MAU + avatar bytes |
| First day as a new active user, skip avatar | ~$0.000835 + Auth MAU + media bytes |
| First day as a new active user, upload avatar | ~$0.000842 + Auth MAU + avatar/media bytes |

The signup path is cheap. The scaling cost comes from daily active use.

## Optional Auth MAU add-on

The base table excludes Auth MAU because Veyl's exact Firebase Auth / Identity Platform billing mode should be confirmed.

If billed under Identity Platform at about `$0.0055/MAU-month` after 50,000 free MAU:

| Monthly active users | Extra Auth cost/month | Extra Auth cost/day |
| ---: | ---: | ---: |
| 100 | $0 if within free tier | $0 |
| 1,000 | $0 if within free tier | $0 |
| 10,000 | $0 if within free tier | $0 |
| 100,000 | about $275/month | about $9.17/day |
| 1,000,000 | about $5,225/month before volume discounts | about $174/day |

## Not included in the monthly table

- Media stored bytes and media download egress.
- Cloud Functions CPU, memory, and outbound network.
- Firestore index-entry reads.
- Spark wallet/payment costs.
- Admin moderation review sessions.

## Main cost risks

1. Chat open is the largest normal-user read cost because it loads recent messages and one older prefetch.
2. Chat warming reads up to two chats on unlock before the user opens anything.
3. Read receipts and reactions currently run the full push-trigger resolver.
4. `bitcoin/current` is read once per mounted client per minute.
5. Media byte costs can dominate if users send and retain large media.

## Sources and calculation notes

Supporting files:

- [assumptions.md](assumptions.md): assumed user behavior per active user per day.
- [basecosts.md](basecosts.md): Firebase/Google Cloud unit costs and free quotas.
- [action-costs.md](action-costs.md): calculated cost per user action.
- [server-actions.md](server-actions.md): detailed source-of-truth audit of repo server actions per user action.

Official pricing sources checked on 2026-05-29:

- Firebase pricing: https://firebase.google.com/pricing
- Firestore pricing and billing behavior: https://firebase.google.com/docs/firestore/pricing
- Firestore location pricing: https://cloud.google.com/firestore/pricing
- Cloud Run pricing: https://cloud.google.com/run/pricing
- Cloud Storage pricing: https://cloud.google.com/storage/pricing
- Identity Platform pricing: https://cloud.google.com/identity-platform/pricing

Calculation summary:

- One normal daily active user is modeled as about 1,219 Firestore read-equivalent operations, 35 Firestore writes, 23 function invocations, and 1 Storage Class A operation.
- Fixed app-wide BTC scheduler cost is 1,440 function invocations and 1,440 Firestore writes per day.
- Paid daily totals subtract 50,000 Firestore reads/day, 20,000 Firestore writes/day, 20,000 Firestore deletes/day, and 2,000,000 function invocations/month.
- Storage operation free quotas are not applied; stored bytes and downloaded bytes are left separate.
