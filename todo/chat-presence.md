# Chat Presence

status: active
branch: current
worktree: current

## Scope

Add lightweight chat presence so each participant can know when the other person is actively viewing a chat.

This should not change current client-derived retention behavior by itself. Messages still use read receipts as the source of truth for seen state, and clients should keep already-visible expiring messages until their own chat view is left.

## Notes

- Prefer an ephemeral, cheap presence shape such as per-chat participant presence with `active`, `updatedAt`, and device/session identity if needed.
- Avoid exposing plaintext beyond what the feature truly needs. Presence is a social/UX signal, not message content.
- Consider whether presence should support "in this chat now", typing indicators, active-device counts, and stale timeout handling.
- If future server-side deletion is added, presence may help avoid deleting or hiding rows for clients that are actively viewing the chat, but client-only retention does not require presence today.

## Open Questions

- Should presence be per account, per device, or per active chat route instance?
- Should the active-chat signal be visible to the other participant, used only locally, or both?
- What stale timeout should clear presence after disconnect, background, crash, or network loss?
