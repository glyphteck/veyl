# DAU scale grid

Source of truth: [model.mjs](model.mjs). This grid uses the default assumptions from [assumptions.md](assumptions.md): 30-day month, 25 visible sends per active user/day, 0.1 wallet tx per active user/day, 360 retained saved-history days, 5 MiB average media, 10% saved media/text, and zero-dollar extras.

## Monthly cost by DAU

| DAU | Base ops/month | Retention/storage/month | Total/month | All-in per active user/day |
| ---: | ---: | ---: | ---: | ---: |
| 1 | ~$0.0002 | ~$0.0061 | ~$0.0062 | ~$0.00021 |
| 10 | ~$0.0015 | ~$0.061 | ~$0.062 | ~$0.00021 |
| 100 | ~$0.015 | ~$0.61 | ~$0.62 | ~$0.00021 |
| 1,000 | ~$11 | ~$6.09 | ~$17 | ~$0.00058 |
| 5,000 | ~$65 | ~$30 | ~$95 | ~$0.00063 |
| 10,000 | ~$132 | ~$61 | ~$193 | ~$0.00064 |
| 25,000 | ~$333 | ~$152 | ~$485 | ~$0.00065 |
| 50,000 | ~$669 | ~$304 | ~$974 | ~$0.00065 |
| 100,000 | ~$1,341 | ~$609 | ~$1,950 | ~$0.00065 |
| 250,000 | ~$3,357 | ~$1,521 | ~$4,879 | ~$0.00065 |
| 500,000 | ~$6,717 | ~$3,043 | ~$9,760 | ~$0.00065 |
| 1,000,000 | ~$13,437 | ~$6,086 | ~$19,523 | ~$0.00065 |
| 2,000,000 | ~$26,877 | ~$12,172 | ~$39,049 | ~$0.00065 |

Tiny DAU levels look storage-heavy because common Firebase free quotas erase most base ops.

## 100k DAU retained-history buildup

At sustained 100k DAU, the base ops piece stays flat under this model. Saved media and saved message-doc storage grow linearly with retained saved-history days.

| Retained saved history | Base ops/month | Retention/storage/month | Total/month | All-in per active user/day |
| ---: | ---: | ---: | ---: | ---: |
| 0 days | ~$1,341 | ~$226 | ~$1,567 | ~$0.00052 |
| 30 days | ~$1,341 | ~$258 | ~$1,599 | ~$0.00053 |
| 90 days | ~$1,341 | ~$322 | ~$1,663 | ~$0.00055 |
| 180 days | ~$1,341 | ~$417 | ~$1,759 | ~$0.00059 |
| 1 year | ~$1,341 | ~$609 | ~$1,950 | ~$0.00065 |
| 2 years | ~$1,341 | ~$991 | ~$2,332 | ~$0.00078 |
| 3 years | ~$1,341 | ~$1,374 | ~$2,715 | ~$0.00090 |
| 4 years | ~$1,341 | ~$1,756 | ~$3,097 | ~$0.00103 |
| 5 years | ~$1,341 | ~$2,138 | ~$3,480 | ~$0.00116 |

Rule of thumb at 100k DAU: every retained saved-history year adds about `$382/month`, or about `$0.00013` per active user/day, to the future run-rate.

## Useful commands

```bash
DAU=100000 bun costs/model.mjs
DAU=100000 RETAINED_SAVED_DAYS=180 bun costs/model.mjs
DAU=250000 RETAINED_SAVED_DAYS=720 bun costs/model.mjs
```
