# DAU scale grid

Source of truth: [model.mjs](model.mjs). This grid uses the default assumptions from [assumptions.md](assumptions.md): 30-day month, 25 visible sends per active user/day, 0.1 wallet tx per active user/day, 360 retained saved-history days, 5 MiB average media, 10% saved media/text, and zero-dollar extras.

## Monthly cost by DAU

| DAU | Base ops/month | Retention/storage/month | Total/month | All-in per active user/day |
| ---: | ---: | ---: | ---: | ---: |
| 1 | ~$0.0002 | ~$0.0066 | ~$0.0067 | ~$0.00022 |
| 10 | ~$0.0015 | ~$0.066 | ~$0.067 | ~$0.00022 |
| 100 | ~$0.015 | ~$0.66 | ~$0.67 | ~$0.00022 |
| 1,000 | ~$11 | ~$6.51 | ~$18 | ~$0.00059 |
| 5,000 | ~$64 | ~$33 | ~$97 | ~$0.00065 |
| 10,000 | ~$132 | ~$65 | ~$197 | ~$0.00066 |
| 25,000 | ~$333 | ~$163 | ~$495 | ~$0.00066 |
| 50,000 | ~$668 | ~$325 | ~$994 | ~$0.00066 |
| 100,000 | ~$1,340 | ~$651 | ~$1,990 | ~$0.00066 |
| 250,000 | ~$3,353 | ~$1,626 | ~$4,979 | ~$0.00066 |
| 500,000 | ~$6,708 | ~$3,253 | ~$9,961 | ~$0.00066 |
| 1,000,000 | ~$13,419 | ~$6,505 | ~$19,925 | ~$0.00066 |
| 2,000,000 | ~$26,841 | ~$13,011 | ~$39,852 | ~$0.00066 |

Tiny DAU levels look storage-heavy because common Firebase free quotas erase most base ops.

## 100k DAU retained-history buildup

At sustained 100k DAU, the base ops piece stays flat under this model. Saved media and saved message-doc storage grow linearly with retained saved-history days.

| Retained saved history | Base ops/month | Retention/storage/month | Total/month | All-in per active user/day |
| ---: | ---: | ---: | ---: | ---: |
| 0 days | ~$1,340 | ~$268 | ~$1,608 | ~$0.00054 |
| 30 days | ~$1,340 | ~$300 | ~$1,639 | ~$0.00055 |
| 90 days | ~$1,340 | ~$364 | ~$1,703 | ~$0.00057 |
| 180 days | ~$1,340 | ~$459 | ~$1,799 | ~$0.00060 |
| 1 year | ~$1,340 | ~$651 | ~$1,990 | ~$0.00066 |
| 2 years | ~$1,340 | ~$1,033 | ~$2,373 | ~$0.00079 |
| 3 years | ~$1,340 | ~$1,415 | ~$2,755 | ~$0.00092 |
| 4 years | ~$1,340 | ~$1,798 | ~$3,137 | ~$0.00105 |
| 5 years | ~$1,340 | ~$2,180 | ~$3,520 | ~$0.00117 |

Rule of thumb at 100k DAU: every retained saved-history year adds about `$382/month`, or about `$0.00013` per active user/day, to the future run-rate.

## Useful commands

```bash
DAU=100000 bun costs/model.mjs
DAU=100000 RETAINED_SAVED_DAYS=180 bun costs/model.mjs
DAU=250000 RETAINED_SAVED_DAYS=720 bun costs/model.mjs
```
