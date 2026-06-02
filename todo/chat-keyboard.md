# Chat Keyboard

status: active
branch: main
worktree: current
base: main@42a298010646
repo version: 4.14.11

## Scope

Keep iOS current-chat keyboard handling responsive while avoiding `KeyboardGestureArea` and route-blocking work.

## Write Boundary

- `apps/ios/app/(vault)/(app)/chat/[peerchatpk]/index.js`
- `apps/ios/app/(vault)/(app)/(home)/chat.js`
- `apps/ios/src/components/chat/messagelist.js`
- any existing iOS keyboard primitive needed for this path

## Collision Notes

The primary checkout has an existing dirty change in `apps/ios/app/(vault)/(app)/(home)/chat.js`, which is inside this task's write boundary. Treat that file as current chat-keyboard work unless the author confirms otherwise. The other dirty iOS peer-picker/share/send files are outside this task's write boundary; do not fold them into keyboard follow-up edits.

## Remaining

- Verify first-open chat navigation on iOS: tapping a chat row should push `/chat/[peerchatpk]` immediately, with any message wait showing inside the message list rather than delaying the route transition.
- Verify interactive keyboard dismissal in current chat: dragging down should move the list with the keyboard and should not add an extra artificial downward list move after the keyboard fully closes.
- Verify composer overlay spacing still behaves with reply/edit bars, command bubbles, multiline input growth, and older-message scrolling.

## Handoff

Current diff removes the pre-route `selectChat()` call from the iOS chat list, defers route-side `selectChat()` until after the first frame in the peer-chat route, delays peer-avatar refresh/prefetch, and moves the chat list back to a manual `useReanimatedKeyboardAnimation()` reserve instead of `KeyboardChatScrollView`.
