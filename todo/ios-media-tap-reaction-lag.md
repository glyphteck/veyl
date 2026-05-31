# iOS Media Tap And Reaction Lag

status: pending device follow-up
branch: current
worktree: current

## Scope

Track the remaining iOS media-message interaction issues only:

- Single tap should open the media viewer reliably.
- Double tap should toggle the reaction without leaking a delayed media-viewer open.
- Repeated reaction toggles should not leave the reaction tray mounting or unmounting with strong lag.

## Write Boundary

- `apps/ios/src/components/chat/messages/usemediatap.js`
- `apps/ios/src/components/chat/messages/reactiontray.js`
- `apps/ios/src/components/chat/messages/image.js`
- `apps/ios/src/components/chat/messages/video.js`
- `apps/ios/src/providers/mediaviewerprovider.js`
- `apps/ios/src/components/menu.js`

## Notes

Do not resurrect the broad message-list architecture diagnostic unless stable dot, row, or receipt animations regress. The current known issue is the media tap classifier and reaction-tray phase timing under fast toggles, not a generic row-shell refactor.
