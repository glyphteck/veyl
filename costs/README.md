# Veyl cost snapshot

Source of truth: [model.mjs](model.mjs). Defaults: 30-day month, 360 retained saved-history days, and zero-dollar extras unless changed in the model.

## Key numbers

| Question | Default answer |
| --- | ---: |
| New signup event | ~$0.000033 |
| One active user, one day | ~$0.00046 in immediate Firebase ops |
| 100k DAU monthly run-rate | ~$1,950/month |
| 100k DAU all-in daily user cost | ~$0.00065 per active user/day |
| 1M DAU monthly run-rate | ~$19,523/month |
| 1M DAU default throughput | ~289 visible messages/s and ~1.2 wallet tx/s |

The default active-user bundle assumes 25 visible sends per active user/day, based on broad messaging-app and SMS benchmarks. Wallet tx/s is expected Spark/network throughput; Spark vendor cost stays in the zero-dollar extras until real rates are known.

## 100k DAU month

This is the default planning case the app should be able to scan quickly.

| Component | Monthly cost |
| --- | ---: |
| Base Firebase ops | ~$1,341 |
| Save ops + media/message storage at 360 retained days | ~$609 |
| **Total** | **~$1,950/month** |

At 100k DAU, the all-in run-rate is about `$1,950 / 100,000 / 30 = $0.00065` per active user/day.

## 100k DAU cost buildup

Saved media and saved message docs grow with active users and the retained saved-history window. At sustained 100k DAU, each additional retained year adds about **$382/month** to the future monthly run-rate.

| Retained saved history | Monthly run-rate |
| ---: | ---: |
| 0 days | ~$1,567 |
| 30 days | ~$1,599 |
| 90 days | ~$1,663 |
| 180 days | ~$1,759 |
| 1 year | ~$1,950 |
| 2 years | ~$2,332 |
| 3 years | ~$2,715 |
| 4 years | ~$3,097 |
| 5 years | ~$3,480 |

## Signup cost

| New-user cost | Amount |
| --- | ---: |
| Account creation ops, avatar weighted | ~$0.000032 |
| First-month avatar storage, avatar weighted | ~$0.0000004 |
| **Total** | **~$0.000033** |

## Where details live

- [assumptions.md](assumptions.md): model variables and the normal daily active-user bundle.
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
