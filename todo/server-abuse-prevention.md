# Server Abuse Prevention

status: active
branch: current
worktree: current
base: main@42a298010646
repo version: 4.14.11

## Scope

Track the one remaining server-abuse decision after the account-creation limits, App Check, upload reservations, Storage gates, and encrypted payload byte caps shipped in `4.14.10`.

## Open Decision

Direct Firestore chat-message writes still need an efficient hard rate-limit design. Do not add a per-message counter doc, per-message callable send, or per-message trigger just to satisfy this todo; those all bloat send cost in different ways. The current hardened layer bounds expensive media and document size but does not count text/control message frequency.

If text/control message write volume becomes a launch blocker, find a design that limits server writes without materially increasing normal per-message cost. Candidate directions to evaluate:

- a low-cardinality token or lease that covers a batch/window of sends instead of one message;
- deterministic document-id windows only if rules can bind the id to `request.time` without bypasses;
- platform-level Firebase/App Check controls if they materially reduce abuse without per-send writes;
- accepting direct writes for now and relying on bans, small payload caps, account creation limits, and Storage quotas.
