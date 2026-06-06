# Chat Keyboard

status: active
branch: main
worktree: current
base: main@6f32fc37d913
repo version: 0.14.3

## Scope

Keep iOS current-chat keyboard handling responsive while avoiding `KeyboardGestureArea` and route-blocking work.

## Write Boundary

- `apps/ios/app/(vault)/(app)/chat/[peerchatpk]/index.js`
- `apps/ios/app/(vault)/(app)/(home)/chat.js`
- `apps/ios/src/components/chat/messages/list.js`
- any existing iOS keyboard primitive needed for this path

## Collision Notes

Keep this focused on iOS chat navigation, current-chat keyboard motion, and composer/list spacing. Shared message-session changes can affect first-open readiness, but do not fold unrelated chat provider refactors into this task unless they directly change route loading behavior.

## Remaining

- Verify first-open chat navigation on iOS: tapping a chat row should push `/chat/[peerchatpk]` immediately, with any message wait showing inside the message list rather than delaying the route transition.
- Verify interactive keyboard dismissal in current chat: dragging down should move the list with the keyboard and should not add an extra artificial downward list move after the keyboard fully closes.
- Verify composer overlay spacing still behaves with reply/edit bars, command bubbles, multiline input growth, and older-message scrolling.

## Handoff

Current repo state already defers route-side `selectChat()` until after the first frame in the peer-chat route. The iOS home chat list still uses `KeyboardChatScrollView`, while the current-chat message list uses `KeyboardStickyView` for composer placement.
