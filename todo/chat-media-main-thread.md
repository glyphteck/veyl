# Chat Media Main Thread

status: active
branch: main
worktree: current
base: main@76eeb51

## Scope

Keep current-chat route entry and route switching responsive when a chat has many image, video, audio, or file messages.

## Write Boundary

- `shared/chat/resolve.js`
- `shared/chat/usemessages.js`
- `shared/chat/messages/session/`
- `shared/providers/chatprovider.js`
- `apps/veyl/ios/src/lib/chatmedia.js`
- `apps/veyl/ios/src/lib/chatdownloads.js`
- `apps/veyl/ios/src/lib/localdatacache.js`
- `apps/veyl/ios/src/lib/msgimagecache.js`
- `apps/veyl/ios/src/components/chat/*`

## Finding

The current route-open bottleneck is not the route push itself. `useChatMessages()` waits for `resolveRenderableMessages()` before marking the list ready, and `resolveRenderableMessages()` calls `readMessageFile()` for every remote attachment in the latest batch. On iOS that can open durable media cache, download from Firebase Storage, decrypt with Expo Crypto AES-GCM, and schedule a durable cache write before first render.

Extra pressure came from media warming and transient render-file tasks. Media warming could continue after a route batch was released, and transient image/file render tasks stayed queued after leaving the chat.

## Current Fix

- Route message resolution now filters only message metadata and obvious expired/invalid attachment refs. Remote attachment bytes are resolved by the media rows instead of blocking route/list readiness.
- The last ready visible message view now survives current-chat route unmounts in a session-only LRU cache keyed to the unlocked local cache and chat keys, so reopening a visited chat seeds the list immediately while the live listener reattaches.
- Releasing a route message batch cancels the current media-warming run.
- Chat warming keeps small message-batch preloading enabled but disables background media downloads on both web and iOS; media bytes load only from normal render/user paths after server-confirmed message docs exist.
- Leaving a message list cancels pending transient media render-file loads.
- iOS durable media cache writes encrypted bytes directly with `expo-file-system` `File.write()` instead of base64-encoding large blobs in JS before `writeAsStringAsync()`.

## Remaining

- Verify on device with a media-heavy chat: open the chat, immediately back out, and open another chat. The route transition should remain responsive while media rows load later.
- Reopen a previously visited chat in the same unlock session. The first frame should render the remembered list with no empty/loading phase, then refresh from the live Firestore batch.
- Watch diagnostics for any remaining multi-second gap between `chat.route`, `chat.list.mount`, and `chat.list.state ready`.
