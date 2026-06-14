# Chat Presence And Read Cost

status: planned
branch: current
worktree: current
base: main@7d56e720d7e5
repo version: 0.14.6

## Goal

Reduce chat read-receipt writes, avoid unnecessary profile refreshes for activity dots, and enable richer presence UI without making encrypted read state less reliable.

## Current Shape

- Public app presence is currently a best-effort `profiles/{uid}.active` boolean written on unlock/lock/app lifecycle.
- Current-user active writes live behind `cloud.user.active.write`.
- Peer active reads can live under `cloud.peer.active`.
- Exact read state is encrypted `t: 'rr'` control messages in `chats/{chatId}/messages`.
- RRs are authoritative for what was read, but writing them too eagerly can add avoidable message-stream writes.
- The public `active` profile field can go stale if a client crashes before writing `false`.
- Profile refreshes are sometimes used just to learn activity even though the chat stream itself already contains useful recent activity signals.

## Direction

Treat presence as a short-lived hint, not as authoritative read state.

- Keep encrypted RRs as the source of truth for exact read position.
- Make RRs lazier: write the latest read target on a quiet timer, on leaving a chat, or before lock/background, rather than treating every newly visible message as an immediate write candidate.
- Add an encrypted chat-presence control payload later, likely `t: 'prs'`, that says this participant is currently viewing this chat until a specific short expiry.
- Presence payloads must be leases with `until` timestamps. A crash should self-heal because the lease expires without requiring an explicit `offline` write.
- Optional exit/offline payloads are only a fast path; expiry is the correctness path.
- Do not put per-chat presence in plaintext chat docs or profile docs.

## Activity Hints

Use recent encrypted stream evidence to update local peer activity without refetching profiles:

- peer sent an RR in the last ~2 minutes
- peer sent a message in the last ~2 minutes
- peer sent a reaction in the last ~2 minutes
- later: peer sent a valid `prs` lease that has not expired

These signals can update a local in-memory or vaulted-cache activity hint keyed by peer chat public key / uid after the peer is already resolved. They should make the avatar active dot feel current and reduce profile refetches whose only purpose is activity.

## Presence Design Notes

- A chat-presence lease should be encrypted in the message stream so only participants learn chat-level presence.
- Lease cadence should be coarse, for example enter immediately, renew around every 60-90 seconds while still focused, and stop renewing on exit/background/lock.
- Sender-side UI can treat a fresh peer presence lease as "currently here" and defer some RR pressure, but it must still accept the eventual RR as the exact read marker.
- Recipient-side retention such as `on seen` must not rely only on presence. Retention should still use visible message processing and/or exact RRs so a stale local presence hint cannot delete content incorrectly.
- Public profile `active` can remain a broad app-online hint, but should eventually become lease-based too, such as `activeUntil`, instead of a sticky boolean.

## Open Questions

- Should app-wide presence move from `profiles/{uid}.active` to `activeUntil` before chat-specific presence ships?
- Should chat presence be a message-stream control payload, a separate encrypted subcollection, or both?
- What UI states do we want: active in app, active in this chat, typing, recently seen, or last active?
- Where should active state appear: peer profiles, search, chat headers, or all of them?
- How should bots participate so Apple Review/demo behavior stays deterministic?
