# Message List Architecture Diagnostic

status: active
branch: current
worktree: current

## Scope

Audit the iOS message list layout and animation structure for unnecessary coupling between core message content, message status dots, reaction trays, read receipts, timestamps, and row height animation.

The immediate diagnostic case is `MsgDot`: it should be visually centered on the core message bubble/content only, and should not need to know about reaction tray or read receipt row-space changes.

## Write Boundary

- `apps/veyl/ios/src/components/chat/messagelist.js`
- `apps/veyl/ios/src/components/chat/receiptmark.js`
- `apps/veyl/ios/src/components/chat/messages/*`

## Questions

- Should `MsgDot` move deeper into the message component tree so it is tied directly to the core message content?
- Should `ReactionTray` expose or own a clearer split between core content and animated accessory space?
- Should `MessageList` own a generic row shell that renders core message content, side accessories, reaction space, and read receipt space as distinct layout layers?
- Can the row-height animation logic be centralized without making the message components harder to follow?

## Possible Changes

- Refactor the row shape to:
  - core message row with bubble/content plus centered side accessories
  - animated reaction tray space below the core row
  - animated read receipt space below the reaction space
- Remove `MsgDot` bottom-offset compensation once it is no longer inside a height-changing tray subtree.
- Keep read receipt avatar rendering separate, but make its row-space contract explicit.
- Keep reaction tray animations inside the reaction component, but expose stable layout boundaries so unrelated accessories do not need timing sync.

## Notes

The current animated `MsgDot` offset is a pragmatic fix for the existing tree. It works, but it is not the ideal ownership model because dot positioning still depends on reaction tray timing.
