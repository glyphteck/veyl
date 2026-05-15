# Chat Media Cache Retention

## Goal

Keep chat media cache growth predictable while preserving the media a user is most likely to open.

## Pending Work

- Add a background cleanup pass that can consider message-list distance, not just cache size and access time.
- Track enough metadata to distinguish media from the latest visible chat windows from media that belongs only to older history.
- Prefer keeping recent media from the top active chats, then recently accessed media, then newest writes.
- Run cleanup off the interaction path after unlock, app resume, and media writes.
- Keep the current durable media limits as a hard cap, but let the cleanup pass proactively drop media that is far outside warm windows before the cap is hit.

## Notes

- The current cache already prunes by total bytes and item count on writes.
- Media reads now refresh cache recency, so old unaccessed files are more likely to be pruned first.
- This plan is only for the deeper message-distance retention policy; chat media prefetching is handled in the provider preload path.
