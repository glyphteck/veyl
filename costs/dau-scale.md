# DAU scale grid

Source of truth: [model.mjs](model.mjs). This grid uses the default assumptions from [assumptions.md](assumptions.md): 30-day month, 3x MAU per DAU, 360 retained saved-history days, 5 MiB average media, 10% saved media/text, and zero-dollar extras.

## Monthly cost by DAU

| DAU | Modeled MAU | Paid Auth MAU | Base ops/month | Retention/storage/month | Auth/month | Total/month | All-in DAU-day |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 3 | 0 | ~$0.0002 | ~$0.0060 | $0 | ~$0.006 | ~$0.00021 |
| 10 | 30 | 0 | ~$0.002 | ~$0.060 | $0 | ~$0.062 | ~$0.00021 |
| 100 | 300 | 0 | ~$0.02 | ~$0.60 | $0 | ~$0.62 | ~$0.00021 |
| 1,000 | 3,000 | 0 | ~$4.82 | ~$6.01 | $0 | ~$11 | ~$0.00036 |
| 5,000 | 15,000 | 0 | ~$32 | ~$30 | $0 | ~$62 | ~$0.00041 |
| 10,000 | 30,000 | 0 | ~$66 | ~$60 | $0 | ~$126 | ~$0.00042 |
| 25,000 | 75,000 | 25,000 | ~$169 | ~$150 | ~$138 | ~$456 | ~$0.00061 |
| 50,000 | 150,000 | 100,000 | ~$340 | ~$301 | ~$550 | ~$1,190 | ~$0.00079 |
| 100,000 | 300,000 | 250,000 | ~$683 | ~$601 | ~$1,375 | ~$2,659 | ~$0.00089 |
| 250,000 | 750,000 | 700,000 | ~$1,710 | ~$1,503 | ~$3,850 | ~$7,063 | ~$0.00094 |
| 500,000 | 1,500,000 | 1,450,000 | ~$3,423 | ~$3,005 | ~$7,975 | ~$14,404 | ~$0.00096 |
| 1,000,000 | 3,000,000 | 2,950,000 | ~$6,849 | ~$6,010 | ~$16,225 | ~$29,085 | ~$0.00097 |
| 2,000,000 | 6,000,000 | 5,950,000 | ~$13,701 | ~$12,021 | ~$32,725 | ~$58,447 | ~$0.00097 |

Tiny DAU levels look storage-heavy because common Firebase free quotas erase most base ops. Auth starts charging once modeled MAU exceeds 50,000.

## 100k DAU retained-history buildup

At sustained 100k DAU, the base ops and Auth pieces stay flat under this model. Saved media and saved message-doc storage grow linearly with retained saved-history days.

| Retained saved history | Base ops/month | Retention/storage/month | Auth/month | Total/month | All-in DAU-day |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 days | ~$683 | ~$236 | ~$1,375 | ~$2,293 | ~$0.00076 |
| 30 days | ~$683 | ~$266 | ~$1,375 | ~$2,324 | ~$0.00077 |
| 90 days | ~$683 | ~$327 | ~$1,375 | ~$2,385 | ~$0.00079 |
| 180 days | ~$683 | ~$418 | ~$1,375 | ~$2,476 | ~$0.00083 |
| 1 year | ~$683 | ~$601 | ~$1,375 | ~$2,659 | ~$0.00089 |
| 2 years | ~$683 | ~$966 | ~$1,375 | ~$3,024 | ~$0.00101 |
| 3 years | ~$683 | ~$1,331 | ~$1,375 | ~$3,389 | ~$0.00113 |
| 4 years | ~$683 | ~$1,697 | ~$1,375 | ~$3,754 | ~$0.00125 |
| 5 years | ~$683 | ~$2,062 | ~$1,375 | ~$4,119 | ~$0.00137 |

Rule of thumb at 100k DAU: every retained saved-history year adds about `$365/month`, or about `$0.00012` per DAU-day, to the future run-rate.

## Useful commands

```bash
DAU=100000 bun costs/model.mjs
DAU=100000 RETAINED_SAVED_DAYS=180 bun costs/model.mjs
DAU=250000 RETAINED_SAVED_DAYS=720 bun costs/model.mjs
```
