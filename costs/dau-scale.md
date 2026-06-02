# DAU scale grid

Source of truth: [model.mjs](model.mjs). This grid uses the default assumptions from [assumptions.md](assumptions.md): 30-day month, 3x MAU per DAU, 360 retained saved-history days, 5 MiB average media, 10% saved media/text, and zero-dollar extras.

## Monthly cost by DAU

| DAU | Modeled MAU | Paid Auth MAU | Base ops/month | Retention/storage/month | Auth/month | Total/month | All-in DAU-day |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 3 | 0 | ~$0.0002 | ~$0.0060 | $0 | ~$0.006 | ~$0.00021 |
| 10 | 30 | 0 | ~$0.002 | ~$0.060 | $0 | ~$0.062 | ~$0.00021 |
| 100 | 300 | 0 | ~$0.02 | ~$0.60 | $0 | ~$0.62 | ~$0.00021 |
| 1,000 | 3,000 | 0 | ~$3.23 | ~$6.01 | $0 | ~$9 | ~$0.00031 |
| 5,000 | 15,000 | 0 | ~$24 | ~$30 | $0 | ~$54 | ~$0.00036 |
| 10,000 | 30,000 | 0 | ~$50 | ~$60 | $0 | ~$110 | ~$0.00037 |
| 25,000 | 75,000 | 25,000 | ~$129 | ~$150 | ~$138 | ~$417 | ~$0.00056 |
| 50,000 | 150,000 | 100,000 | ~$261 | ~$301 | ~$550 | ~$1,111 | ~$0.00074 |
| 100,000 | 300,000 | 250,000 | ~$524 | ~$601 | ~$1,375 | ~$2,500 | ~$0.00083 |
| 250,000 | 750,000 | 700,000 | ~$1,314 | ~$1,503 | ~$3,850 | ~$6,667 | ~$0.00089 |
| 500,000 | 1,500,000 | 1,450,000 | ~$2,631 | ~$3,005 | ~$7,975 | ~$13,612 | ~$0.00091 |
| 1,000,000 | 3,000,000 | 2,950,000 | ~$5,265 | ~$6,010 | ~$16,225 | ~$27,501 | ~$0.00092 |
| 2,000,000 | 6,000,000 | 5,950,000 | ~$10,533 | ~$12,021 | ~$32,725 | ~$55,279 | ~$0.00092 |

Tiny DAU levels look storage-heavy because common Firebase free quotas erase most base ops. Auth starts charging once modeled MAU exceeds 50,000.

## 100k DAU retained-history buildup

At sustained 100k DAU, the base ops and Auth pieces stay flat under this model. Saved media and saved message-doc storage grow linearly with retained saved-history days.

| Retained saved history | Base ops/month | Retention/storage/month | Auth/month | Total/month | All-in DAU-day |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 days | ~$524 | ~$236 | ~$1,375 | ~$2,135 | ~$0.00071 |
| 30 days | ~$524 | ~$266 | ~$1,375 | ~$2,165 | ~$0.00072 |
| 90 days | ~$524 | ~$327 | ~$1,375 | ~$2,226 | ~$0.00074 |
| 180 days | ~$524 | ~$418 | ~$1,375 | ~$2,318 | ~$0.00077 |
| 1 year | ~$524 | ~$601 | ~$1,375 | ~$2,500 | ~$0.00083 |
| 2 years | ~$524 | ~$966 | ~$1,375 | ~$2,865 | ~$0.00096 |
| 3 years | ~$524 | ~$1,331 | ~$1,375 | ~$3,230 | ~$0.00108 |
| 4 years | ~$524 | ~$1,697 | ~$1,375 | ~$3,596 | ~$0.00120 |
| 5 years | ~$524 | ~$2,062 | ~$1,375 | ~$3,961 | ~$0.00132 |

Rule of thumb at 100k DAU: every retained saved-history year adds about `$365/month`, or about `$0.00012` per DAU-day, to the future run-rate.

## Useful commands

```bash
DAU=100000 bun costs/model.mjs
DAU=100000 RETAINED_SAVED_DAYS=180 bun costs/model.mjs
DAU=250000 RETAINED_SAVED_DAYS=720 bun costs/model.mjs
```
