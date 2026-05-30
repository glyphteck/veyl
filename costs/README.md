# Veyl monthly cost report

## Summary

Using the default model, the all-in planning total for **1,000,000 daily active users over one month is about `$29,085/month`**. This includes base Firebase operations, expected save operations, retained Firestore docs, live and saved media storage, avatar storage, and paid Auth MAU after the free quota. Zero-default extras remain counted as `$0` unless changed in [model.mjs](model.mjs).

Under the default usage assumptions, one daily active user costs about:

**$0.00024/day in immediate Firebase operations, including expected save operations but before monthly retained storage and Auth run-rate.**

That number is dominated by chat sends, read receipts, adaptive chat opening, and the bitcoin listener. Account creation is effectively negligible compared with ongoing daily use.

Saved retention is modeled as per-DAU-day growth instead of a separate scale-only table. With the default 5 MiB average media object, each DAU-day also adds about 2.2 KiB of saved Firestore message docs and about 0.5 MiB of saved media retained forever.

The default cost model lives in [model.mjs](model.mjs). Change the assumptions there, or run it with environment overrides:

```bash
DAU=1000000 MEDIA_MIB=10 RETAINED_SAVED_DAYS=180 bun costs/model.mjs
```

The CLI also accepts zero-default extras such as `MEDIA_DOWNLOAD_GIB_PER_DAU_MONTH`, `MEDIA_DOWNLOAD_GIB_COST`, `FUNCTION_COMPUTE_COST_PER_DAU_MONTH`, `SPARK_COST_PER_DAU_MONTH`, and `MODERATION_COST_MONTH`.

## Default Variables

| Variable | Default |
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

## Assumed daily active user

One daily active user is assumed to:

- launch/unlock once for a 10 minute mounted session,
- open 3 chats,
- send 10 text or payment-request messages,
- read 10 messages, causing read receipts,
- react to 2 messages,
- send 1 media or long-text message averaging 5 MiB,
- save 10% of sent messages and 10% of sent media forever,
- run 1 username/profile search returning about 10 profiles.

## Cost per daily active user

| Daily activity | Expected daily cost or storage effect |
| --- | ---: |
| Launch/unlock, 10 min | ~$0.000040 |
| Open 3 chats | ~$0.000042 normal, higher in control-heavy spans |
| Send 10 messages | ~$0.000094 |
| Read 10 messages | ~$0.000036 |
| React twice | ~$0.000007 |
| Send 1 media item | ~$0.000014 |
| Save 10% of sent messages/media | ~$0.000010 + retained storage growth |
| Search once | ~$0.000006 |
| **Total immediate ops per daily active user** | **~$0.00024/day** |

## Monthly cost by user base

This table uses daily active users, not registered accounts. It includes the fixed BTC scheduler, applies the common Firebase free quotas from [basecosts.md](basecosts.md), assumes monthly active users are 3x DAU, and includes paid Auth MAU after the 50,000 MAU free quota. The retention/storage column uses the per-DAU-day model below with 360 retained days, which is the approximate 12-month run-rate after saved bytes have accumulated.

| Daily active users | Base ops/month | 12-month retention/storage run-rate | Auth/month | Estimated paid cost/month |
| ---: | ---: | ---: | ---: | ---: |
| 100 | ~$0.02 | ~$0.60 | ~$0 | ~$0.62 |
| 1,000 | ~$4.82 | ~$6 | ~$0 | ~$11 |
| 10,000 | ~$66 | ~$60 | ~$0 | ~$126 |
| 100,000 | ~$683 | ~$601 | ~$1,375 | ~$2,659 |
| 1,000,000 | ~$6,849 | ~$6,011 | ~$16,225 | ~$29,085 |

## Storage Retention Growth

Retained saved messages and media accumulate over time, so the useful primitive is a per-DAU-day storage addition:

- 10 text/payment messages + 1 media message creates 11 message docs per DAU-day.
- Saving 10% forever retains about 1.1 message docs per DAU-day.
- At 2 KiB per saved message doc, Firestore retained docs grow by about 2.2 KiB per DAU-day.
- At the default 5 MiB media size, saved media grows by about 0.5 MiB per DAU-day.
- Save operations add about `$0.000010` per DAU-day.

Each retained saved-history day increases future monthly storage run-rate by about `$0.000010` per DAU: about `$0.0000098` from saved media and about `$0.00000038` from saved Firestore docs. The saved-media bytes dominate.

The routine media live set is separate. One 5 MiB media item per DAU-day reaches a 21-day live set of about 105 MiB per DAU after lifecycle deletion catches up, costing about `$0.00205` per DAU-month at the current regional `US-CENTRAL1` Firebase Storage bucket cost of about `$0.020/GiB-month`.

For a steady DAU base, estimate the monthly retention/storage add-on for a 30-day month as:

```txt
DAU * (
  $0.000308 save operations
  + $0.002051 routine 21-day media live set
  + $0.00001014 * retained_saved_days
)
```

At 1,000,000 DAU and 360 retained saved days, that is about `$6,011/month`: roughly `$308` save operations, `$2,051` routine live media storage, `$3,516` saved media storage, and `$136` saved Firestore message-doc storage. Download egress is modeled as `$0` by default.

## One-time new-user costs

This is the paid marginal new-account cost after the free Auth MAU quota is exhausted. The monthly table applies the free Auth quota before charging Auth.

| One-time flow | Expected cost |
| --- | ---: |
| Weighted account creation ops | ~$0.000032 |
| Weighted first-month avatar storage | ~$0.0000004 |
| Paid Auth MAU | ~$0.0055 |
| **Expected paid marginal new-account total** | **~$0.00553** |

The signup path is cheap. The scaling cost comes from daily active use.

## Zero-Dollar Defaults

The monthly table is a single-number Firebase operating model. It intentionally assumes `$0` for media download egress, Cloud Functions CPU/memory beyond invocation charges, Cloud Functions outbound network, Firestore index-entry reads, Spark wallet/payment costs, and admin moderation labor. Those are zero-default variables in [model.mjs](model.mjs).

## Main cost risks

1. Control-heavy or mostly hidden chats can force adaptive latest-message queries up to the 60-doc foreground cap.
2. `bitcoin/current` is read once per mounted client per minute.
3. Media byte costs can dominate if users send and retain large media; saved media grows linearly with retained DAU-days.

## Sources and calculation notes

Supporting files:

- [model.mjs](model.mjs): executable cost functions and default assumptions.
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

- One normal daily active user is modeled as about 260 Firestore read-equivalent operations, 35 Firestore writes, 11 function invocations, and 1 Storage Class A operation.
- Fixed app-wide BTC scheduler cost is 1,440 function invocations and 1,440 Firestore writes per day.
- Paid totals subtract 50,000 Firestore reads/day, 20,000 Firestore writes/day, 20,000 Firestore deletes/day, 2,000,000 function invocations/month, and 50,000 Auth MAU/month.
- Storage operation free quotas are not applied; stored bytes use the media and avatar assumptions above, and downloaded bytes are left separate.
