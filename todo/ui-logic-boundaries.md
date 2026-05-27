# UI Logic Boundaries

status: active
branch: main
worktree: current
base: main

## Scope

Review Veyl web and iOS `components/` and `lib/` folders and separate UI from non-UI logic where the boundary is currently blurry.

## Write Boundary

- `apps/veyl/web/src/components/**`
- `apps/veyl/web/src/lib/**`
- `apps/veyl/ios/src/components/**`
- `apps/veyl/ios/src/lib/**`
- focused shared helpers only when logic is duplicated across web and iOS

## Review Questions

- Which files under `components/` own data shaping, sorting, query parsing, cache decisions, media resolution, navigation state, or other logic that should move to `lib/` or `shared/`?
- Which files under `lib/` render UI or contain component-specific presentation details that should move back under `components/`?
- Which hooks are UI hooks versus logic hooks, and should names or locations make that clearer?
- Which web and iOS surfaces solve the same logic separately and should share a single helper?

## Plan

1. Inventory web `components/` and `lib/` and tag files as UI, logic, provider wiring, or mixed.
2. Inventory iOS `components/` and `lib/` the same way.
3. Prioritize mixed files that are hard to test or reuse, especially chat, media, peer/search, wallet, and menu surfaces.
4. Move pure logic out of UI files in small focused patches.
5. Keep component files responsible for rendering, local interaction state, and visual composition.
6. Document any durable boundary rule that emerges in `guidelines/code.md` or `guidelines/uistyling.md`.

## Notes

Use the web main menu split as a reference point: rendering stays in `components/dialogs/mainmenu.js`, while pure row-windowing, filtering, ordering, and formatting helpers can live in `apps/veyl/web/src/lib/mainmenu.js`.
