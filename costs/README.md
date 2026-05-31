# Veyl cost snapshot

Source of truth: [model.mjs](model.mjs). Defaults: 30-day month, 3x MAU per DAU, 360 retained saved-history days, and zero-dollar extras unless changed in the model.

## Key numbers

| Question | Default answer |
| --- | ---: |
| New signup event | ~$0.000033 before paid Auth MAU |
| Paid Auth MAU add-on | ~$0.0055 for that active month after the free quota |
| One normal active user-day | ~$0.00024 in immediate Firebase ops |
| 100k DAU monthly run-rate | ~$2,659/month |
| 100k DAU all-in user-day | ~$0.00089 per DAU-day |
| 1M DAU monthly run-rate | ~$29,085/month |

The signup path is cheap. Scale cost comes from daily active use, Auth MAU, media storage, and saved-message retention.

## 100k DAU month

This is the default planning case the app should be able to scan quickly.

| Component | Monthly cost |
| --- | ---: |
| Base Firebase ops | ~$683 |
| Save ops + media/message storage at 360 retained days | ~$601 |
| Paid Auth MAU, assuming 300k MAU | ~$1,375 |
| **Total** | **~$2,659/month** |

At 100k DAU, the all-in run-rate is about `$2,659 / 100,000 / 30 = $0.00089` per DAU-day.

## 100k DAU cost buildup

Saved media and saved message docs grow with retained DAU-days. At sustained 100k DAU, each additional retained year adds about **$365/month** to the future monthly run-rate.

| Retained saved history | Monthly run-rate |
| ---: | ---: |
| 0 days | ~$2,293 |
| 30 days | ~$2,324 |
| 90 days | ~$2,385 |
| 180 days | ~$2,476 |
| 1 year | ~$2,659 |
| 2 years | ~$3,024 |
| 3 years | ~$3,389 |
| 4 years | ~$3,754 |
| 5 years | ~$4,119 |

## Signup cost

| New-user cost | Amount |
| --- | ---: |
| Account creation ops, avatar weighted | ~$0.000032 |
| First-month avatar storage, avatar weighted | ~$0.0000004 |
| Paid Auth MAU for that active month | ~$0.0055 |
| **Paid marginal first active month** | **~$0.00553** |

The monthly model applies the first 50,000 Auth MAU free before charging Auth.

## Where details live

- [assumptions.md](assumptions.md): model variables and the normal DAU bundle.
- [dau-scale.md](dau-scale.md): larger DAU grids and 100k DAU retention buildup.
- [basecosts.md](basecosts.md): Firebase/Google unit costs and free quotas.
- [action-costs.md](action-costs.md): gross cost per user action.
- [message-rate-costs.md](message-rate-costs.md): sustained messages-per-second costs.
- [server-actions.md](server-actions.md): repo-derived server-action audit.

Run the model directly:

```bash
DAU=100000 bun costs/model.mjs
RETAINED_SAVED_DAYS=720 DAU=100000 bun costs/model.mjs
```
