# iOS Glass Styling Pass

status: active
branch: current
worktree: current
base: main@aba9ac4bd16f
repo version: 0.14.18

## Scope

Audit glass styling across the iOS app after the iOS 27 glass rendering changes, with special focus on inputs, disabled buttons, message bubbles, and destructive-action treatment.

Inputs now share `inputGlassTint(theme)` through `GlassField`, search, and composer surfaces. Disabled glass controls use `disabledGlassTint(theme)` through `GlassButton`, `GlassIcon`, and the in-message payment action. Message bubbles now use plain `View` surfaces with shared `bubbleStyle`/`bubbleShadow` helpers from `apps/ios/src/lib/chat/messages.js` so bubble styling stays separate from input styling and native glass.

## Open Questions

- Are stacked glass surfaces making header icons and inputs darker than the standalone primitive?
- Should destructive button styling be removed from glass controls entirely, keeping only disabled state plus explicit feedback text when an action cannot run or needs confirmation?

## Write Boundary

- `apps/ios/src/components/glass/`
- `apps/ios/src/components/search.js`
- `apps/ios/src/components/glass/glassfield.js`
- iOS call sites that still pass custom glass tints around inputs or action buttons
- `apps/ios/src/lib/colors.js`
- `guidelines/uistyling.md`

## Acceptance Criteria

- Inputs have one shared default style that carries through the input primitive instead of per-screen overrides.
- Disabled and destructive glass buttons no longer look overly dark, muddy, or visually broken on iOS 27.
- Any destructive action that loses destructive color still communicates state through button text, confirmation flow, or disabled copy.
- Color token names remain generic and pattern-matched, not named after a one-off component.
