# Server Abuse Prevention

status: active
branch: current
worktree: current
base: main@67ddbff7

## Scope

Add server-side abuse controls that make the public client safe enough to ship against the centralized backend. This task covers account-creation rate limits, upload quotas, Storage write gates, and the cheapest enforceable chat-message hardening that does not move every message through a callable.

This does not attempt to make the backend fully trustless yet. The backend remains centralized and managed by Glyphteck.

## Config

Initial limits are intentionally conservative because server cost is personally funded and the app is pre-launch:

- `ACCOUNT_CREATE_IP_MINUTE_LIMIT = 2`
- `ACCOUNT_CREATE_IP_HOUR_LIMIT = 6`
- `ACCOUNT_CREATE_IP_DAY_LIMIT = 20`
- `NEW_ACCOUNT_WINDOW_DAYS = 7`
- `NEW_ACCOUNT_UPLOAD_BYTES_PER_DAY = 50 * MiB`
- `ESTABLISHED_ACCOUNT_UPLOAD_BYTES_PER_DAY = 250 * MiB`
- `CHAT_MEDIA_UPLOAD_RESERVATION_TTL_MINUTES = 15`
- `CHAT_MEDIA_MAX_FILE_BYTES = 20 * MiB`
- `REPORT_EVIDENCE_UPLOAD_RESERVATION_TTL_MINUTES = 15`
- `REPORT_EVIDENCE_MAX_FILE_BYTES = 20 * MiB`
- `CHAT_MESSAGE_BODY_MAX_BYTES = 64 * KiB`
- `CHAT_LAST_MESSAGE_BODY_MAX_BYTES = 64 * KiB`
- `CHAT_SETTINGS_BODY_MAX_BYTES = 32 * KiB`

Rationale:

- Account creation is high-leverage abuse because every account can consume profile, auth, Firestore, Storage, and support overhead. Six accounts per hour per IP is enough for shared home/NAT review use, but low enough to stop simple scripted signups. Twenty per day per IP still supports review labs and small shared networks without giving one IP unlimited account inventory.
- New accounts get a hard 50 MiB/day upload budget across quota-gated Storage creates. With the current 20 MiB per-file cap, a new account can send a few meaningful files or report evidence but cannot burn Storage bandwidth indefinitely on day one.
- Established accounts get 250 MiB/day. This keeps normal personal use comfortable while preserving a bounded cost model. The number can rise later after abuse telemetry and billing data exist.
- Upload reservations expire after 15 minutes. This is long enough for mobile resumable uploads and short enough that leaked or abandoned reservations do not remain useful.
- Message body caps are not a rate limit, but they are zero-extra-write protection against Firestore document bloat. True server-side message rate counting cannot be done on direct Firestore writes without either adding a per-send counter write/read or routing sends through a callable/worker.

## Write Boundary

- `functions/lib/*`
- `functions/passkey/register.js`
- `functions/chat/media.js`
- `functions/index.js`
- `storage.rules`
- `firestore.rules`
- `firestore.indexes.json`
- `shared/config.js`
- `shared/chat/filepayload.js`
- `shared/files.js`
- `apps/ios/src/lib/chat/media.js`
- platform chat providers if callable injection is needed
- `CHANGELOG.md`

## Plan

1. Centralize backend abuse config in Functions-local constants.
2. Add hard IP limits to the actual account creation step, not only registration option/verify attempts.
3. Add reservation callables that validate auth, size, path, content type, and account age, then atomically reserve bytes against the shared daily account-upload quota bucket.
4. Require a matching unexpired reservation in Storage rules before allowing `media/{mediaId}/main` and report evidence creates.
5. Update web and iOS upload paths to reserve upload bytes before writing to Storage.
6. Add Firestore rules caps for encrypted message, last-message, and chat-settings byte payload sizes.
7. Lint touched JS files and deploy changed backend targets.

## Handoff

Open security decision: direct Firestore chat-message writes still need an efficient hard rate-limit design. Do not add a per-message counter doc, per-message callable send, or per-message trigger just to satisfy this todo; those all bloat send cost in different ways. The current hardened layer is quota-gated uploads plus Firestore payload caps, which bounds expensive media and document size but does not count text/control message frequency.

If text/control message write volume becomes a launch blocker, find a design that limits server writes without materially increasing normal per-message cost. Candidate directions to evaluate:

- a low-cardinality token or lease that covers a batch/window of sends instead of one message;
- deterministic document-id windows only if rules can bind the id to `request.time` without bypasses;
- platform-level Firebase/App Check controls if they materially reduce abuse without per-send writes;
- accepting direct writes for now and relying on bans, small payload caps, account creation limits, and Storage quotas.
