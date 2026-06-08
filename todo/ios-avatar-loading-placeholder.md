# iOS Avatar Loading Placeholder

status: pending follow-up
branch: current
worktree: current
base: main@7d56e720d7e5
repo version: 0.14.6

## Scope

Restore a visible default avatar while an iOS profile image is loading without reintroducing the old two-state overlay bug.

## Constraint

The avatar source remains the render truth:

- If there is no avatar source, render the default glyph.
- If there is an avatar source, render the masked image.
- Any loading placeholder must not mount above the profile image or depend on per-instance `onLoad` state that can disagree with native image painting.

Prefer a placeholder behind the image or a single prefetch owner if this becomes worth fixing.
