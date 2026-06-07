# Traffic Client Load Follow-Up

status: active
branch: current
worktree: current
base: main@004b67abe2e1
repo version: 0.14.4

## Goal

Finish verification and any remaining optimization for web and iOS clients under high-volume incoming messages and transfers.

## Context

- Use the documented traffic workflow in `bots.md` and `guidelines/bots.md`.
- Default target is `@zxrl`.
- Human must keep web and iOS unlocked on the target account before client observations are meaningful.
- Use `bun dev -v` so web, iOS, and bot logs expose the receive path.
- Stop queued/running traffic with `bun bot traffic stop` before changing traffic shape or restarting runtimes.
- Current source includes wallet history ownership gates, background history coverage for web dashboard ranges, smaller iOS transfer-list render batches, and concurrent bot message traffic. The remaining task is observation on unlocked clients, not another blind optimization pass.

## Remaining Work

- Re-run controlled mixed and solo traffic after the latest transfer-history changes:

```bash
bun dev -v
bun bot traffic mixed @zxrl fast --count 50 --no-wait
bun bot traffic msg @zxrl fast --solo --count 60 --no-wait
```

- Run a short opaque chat smoke on web, iOS, and bot against deployed rules/functions: simultaneous starts, inbox pings, established sends without parent chat docs, own-message edits, forged peer edit rejection, `pay_confirm`, hard message delete from either side, whole-chat delete, save/unsave text and chat-media messages, old seen media unsave, saved media hard-delete, and active-client source-doc clearing.
- Verify iOS wallet scrolling no longer outruns painted transfer rows after the smaller reveal batch and visible-history split.
- Verify the web wallet dashboard fills full-history timeframe options and chart data from background-reconciled history without requiring a manual scroll through the transfer list.
- Watch iOS main-thread responsiveness during simultaneous message and transfer traffic. If interaction stalls remain, inspect verbose logs for repeated wallet aggregation, profile/avatar fetches, cache writes, or list-wide rerenders.
- Confirm transfer ownership remains fail-closed on both clients: no cached transfer row should display unless the unlocked wallet public key is the sender or receiver.
- Keep runtime logs available during each observation pass, and record any reproducible bottleneck before patching.

## Validation

- Lint only touched files or packages.
- Do not mark this task done until mixed message/transfer traffic and `msg --solo` single-chat traffic have been observed on both unlocked clients after the latest changes.
