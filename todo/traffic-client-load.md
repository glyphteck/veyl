# Traffic Client Load Follow-Up

## Goal

Finish verification and any remaining optimization for web and iOS clients under high-volume incoming messages and transfers.

## Context

- Use the documented traffic workflow in `bots.md` and `guidelines/bots.md`.
- Default target is `@zxrl`.
- Human must keep web and iOS unlocked on the target account before client observations are meaningful.
- Use `bun dev -v` so web, iOS, and bot logs expose the receive path.
- Stop queued/running traffic with `bun bot traffic stop` before changing traffic shape or restarting runtimes.

## Remaining Work

- Re-run controlled mixed and solo traffic after the latest transfer-history changes:

```bash
bun dev -v
bun bot traffic mixed @zxrl fast --count 50 --no-wait
bun bot traffic msg @zxrl fast --solo --count 60 --no-wait
```

- Verify iOS wallet scrolling no longer outruns painted transfer rows after the smaller reveal batch and visible-history split.
- Verify the web wallet dashboard fills full-history timeframe options and chart data from background-reconciled history without requiring a manual scroll through the transfer list.
- Watch iOS main-thread responsiveness during simultaneous message and transfer traffic. If interaction stalls remain, inspect verbose logs for repeated wallet aggregation, profile/avatar fetches, cache writes, or list-wide rerenders.
- Confirm transfer ownership remains fail-closed on both clients: no cached transfer row should display unless the unlocked wallet public key is the sender or receiver.
- Keep runtime logs available during each observation pass, and record any reproducible bottleneck before patching.

## Validation

- Lint only touched files or packages.
- Do not mark this task done until mixed message/transfer traffic and `msg --solo` single-chat traffic have been observed on both unlocked clients after the latest changes.
