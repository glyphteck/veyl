# GIF Messages

status: pending manual verification
branch: current
worktree: current
base: main@40135c16ca3b
repo version: 0.15.1

## Scope

Add first-class animated GIF chat messages across web and iOS.

## Non-Goals

- Do not add GIF search, sticker packs, remote GIF provider integrations, or third-party keyboards in this task.
- Do not add legacy compatibility or duplicate `img` / `gif` fallback paths.
- Do not make the server understand GIF semantics; media type and render behavior stay inside encrypted payloads and clients.

## Write Boundary

- Shared attachment typing and payload helpers: `shared/chat/attachments.js`, `shared/chat/media.js`, `shared/chat/messages/*`, and `shared/config.js` if media warming needs a type or byte-policy adjustment.
- Web picker/prepare/render/download path: `apps/web/src/lib/chat/files.js`, `apps/web/src/lib/chat/messages.js`, `apps/web/src/components/chat/messages/*`, and reply/media viewer surfaces as needed.
- iOS picker/prepare/render/download path: `apps/ios/src/components/chat/chatinput.js`, `apps/ios/src/lib/chat/*`, `apps/ios/src/components/chat/messages/*`, and the media viewer as needed.
- Storage and lifecycle docs only if the payload or media lifecycle contract changes: `guidelines/chat.md`, `lifecycle/msg.md`, `guidelines/security.md`, and possibly `storage.rules`.

## Plan

1. Verify web can send an animated GIF and the recipient sees animation in the message row, reply thumbnail, and shared-media destination.
2. Verify iOS can send an animated GIF from Photos or Files and the recipient sees animation in the message row, reply thumbnail, and fullscreen media viewer.
3. Verify save/unsave, delete cleanup, download/share, local retry, report evidence, and bot echo behavior still treat GIFs as encrypted chat media.
4. After verification, delete this todo and keep the shipped payload contract in `guidelines/chat.md`.

## Handoff

The code path now uses a separate encrypted payload type `gif` while reusing the image render/cache/viewer surfaces. The remaining risk is runtime animation support in the web and iOS image renderers plus platform download/share behavior.
