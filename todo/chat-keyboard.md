# Chat Keyboard

status: active
branch: main
worktree: current
base: main@76eeb51

## Scope

Keep iOS current-chat keyboard handling responsive while avoiding `KeyboardGestureArea` and route-blocking work.

## Write Boundary

- `apps/veyl/ios/app/(vault)/(app)/currentchat.js`
- `apps/veyl/ios/app/(vault)/(app)/(home)/chatlist.js`
- `apps/veyl/ios/src/components/chat/messagelist.js`
- any existing iOS keyboard primitive needed for this path

## Collision Notes

The primary checkout has unrelated dirty work. Keep this task limited to current-chat route entry and current-chat keyboard dismissal.

## Remaining

- Verify first-open chat navigation on iOS: tapping a chat row should push `/currentchat` immediately, with any message wait showing inside the message list rather than delaying the route transition.
- Verify interactive keyboard dismissal in current chat: dragging down should move the list with the keyboard and should not add an extra artificial downward list move after the keyboard fully closes.
- Verify composer overlay spacing still behaves with reply/edit bars, command bubbles, multiline input growth, and older-message scrolling.

## Handoff

Current diff removes the pre-route `selectChat()` call from the iOS chat list, defers route-side `selectChat()` until after the first frame, delays peer-avatar refresh/prefetch, and moves the current-chat list back to a manual `useReanimatedKeyboardAnimation()` reserve instead of `KeyboardChatScrollView`.
