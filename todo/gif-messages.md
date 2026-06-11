# GIF Messages

status: active
branch: current
worktree: current
base: main@dd4fbb925656
repo version: 0.14.15

## Scope

Add support for animated GIFs as chat media messages across web and iOS.

The current media path treats `image/*` as `img`, but web image preparation converts non-PNG images to JPEG, which strips GIF animation. GIF support should preserve animation, captions, dimensions, caching, sharing, save/unsave, delete cleanup, downloads, previews, and reply thumbnails through the existing encrypted chat media lifecycle.

Prefer one shared representation. The likely shape is still `img` with `m: image/gif`, because GIF is an image subtype and the existing message contract already uses `img` for image payloads. Add a separate `gif` payload type only if the renderer, cache, or lifecycle behavior cannot stay cleanly under `img`.

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

1. Confirm the payload choice: keep GIFs as `img` with `m: image/gif` unless a separate message type has a clear ownership benefit.
2. Update attachment preparation so GIF bytes are not transcoded or flattened, while existing JPEG/PNG and video shaping stays unchanged.
3. Make render, reply, media viewer, download, share, cache, and warmup paths treat animated GIF image messages consistently on web and iOS.
4. Keep upload limits and Storage metadata aligned with the existing encrypted chat media model.
5. Update the chat/media lifecycle docs if the supported image contract changes.

## Handoff

Start from the current chat media path rather than adding a new attachment stack. The main risk is accidentally converting GIFs into JPEG previews or creating two image representations that drift across web and iOS.
