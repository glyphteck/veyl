# Chat Keyboard

status: active
branch: keyboard
worktree: /Users/zaksorel/glyphteck/worktrees/keyboard
base: main@ab773d9

## Scope

Fix iOS current-chat keyboard handling so the message list follows the keyboard, while avoiding `KeyboardGestureArea`.

## Write Boundary

- `apps/veyl/ios/app/(vault)/(app)/currentchat.js`
- `apps/veyl/ios/src/components/chat/chatinput.js`
- `apps/veyl/ios/src/components/chat/messagelist.js`
- any existing iOS keyboard primitive needed for this path

## Collision Notes

The primary checkout has unrelated dirty work, including the current-chat and chat component files. Implementation is isolated in `/Users/zaksorel/glyphteck/worktrees/keyboard` on branch `keyboard`.

## Plan

1. Inspect the existing iOS current-chat keyboard layout and keyboard-controller usage.
2. Replace the list keyboard avoidance path with the relevant keyboard-controller chat/list primitive if available.
3. Keep footer/composer sticking behavior on the sticky primitive and do not use `KeyboardGestureArea`.
4. Run targeted lint only on touched files.

## Handoff

Merged into the primary `main` working tree. The current diff replaces the manual inverted-list keyboard spacer in `apps/veyl/ios/src/components/chat/messagelist.js` with the existing `KeyboardChatScrollView` wrapper around the keyboard-controller chat primitive. Composer, command bubbles, reply/edit draft bar, and scroll-to-bottom controls still use `KeyboardStickyView`, and no `KeyboardGestureArea` path is used.

Temporary composer overlays now animate through one measured overlay stack over 160ms, and that stack height feeds the chat-scroll primitive through `extraContentPadding`. Reply/edit draft bars pop as one temporary row. Command bubbles keep per-bubble pop animations while the command area expands/collapses around the measured overlay stack.

Latest fix: the choppy `PopSlot` path was removed. Reply/edit and command chips now use Reanimated scale-only enter/exit plus layout transitions, and `currentchat.js` measures one composer overlay stack whose animated height is the only value passed to `KeyboardChatScrollView.extraContentPadding`. This avoids duplicate hidden glass measurement and avoids sending independent command/draft padding deltas to the keyboard-controller scroll primitive.

Follow-up fix: reply/edit and commands now keep exiting content mounted through the 160ms scale-out instead of relying on unmount exit animations. The active overlay height still collapses `extraContentPadding` immediately over 160ms, while retained exiting views are ignored by the padding measurement. Edit input growth is no longer applied through React `FlatList` padding; the first composer height becomes the base `inputH`, and later multiline input growth is folded into the same derived `extraContentPadding` shared value as the overlay stack.

Inverted-list correction: composer overlay/input growth spacing is now rendered as an animated `ListHeaderComponent` at the newest edge of the inverted list. `KeyboardChatScrollView.extraContentPadding` is no longer used for reply/edit/command spacing because its inverted scroll correction subtracts positive deltas, which moved this chat visually in the wrong direction when reply/edit appeared.

Latest fix: command bubbles now only animate when entering from empty or exiting to empty. Non-empty command changes, such as the multi-command suggestion state switching to the single current command, replace the rendered bubbles directly. Reply/edit now reports when its scale-out finishes, and the composer overlay spacer stays active until that callback so the inverted list does not shrink before the draft row finishes animating out.

Validation: `bun x eslint "apps/veyl/ios/src/components/chat/chatinput.js" "apps/veyl/ios/src/components/chat/messagelist.js" "apps/veyl/ios/app/(vault)/(app)/currentchat.js" "apps/veyl/ios/src/components/keyboardscroll.js" --quiet` passed from the primary checkout.

Needs device check: open current chat on iOS, focus the composer, verify newest messages move with the keyboard during open/interactive dismiss, verify reply/edit and command overlays reserve space smoothly, and verify older-message scrolling still works.
