# Media Destructive Deletion

## Open Question

Media files now use opaque encrypted `media/{mediaId}/main` Storage objects with a 21-day lifecycle TTL. Per-message permanence keeps the same Storage object and records encrypted random message stays while Firestore stores only opaque per-file stay counts. Cloud Storage temporary holds are derived from those stay counts instead of moving, copying, or reuploading bytes. Chat/message deletion is intentionally separate from Storage retention, so normal message deletion does not break forwarded messages that reference the same file capability.

The unresolved product question is whether Veyl should add a manual destructive media-delete action before the TTL expires. Users would need to understand whether deleting a media message only removes that chat message or removes the backend file wherever it was shared.

Tradeoffs:

- Keep shared Storage objects until all refs disappear: preserves forwarded messages, but can conflict with a user's expectation that delete means the file is gone.
- Delete the Storage object when the source message is deleted: honors strong deletion intent, but breaks every recipient's forwarded message and cached-download assumptions.
- Reupload or copy on share: gives each shared message independent deletion semantics, but loses the efficiency goal and creates more backend storage churn.
- Track refs centrally: enables ref-aware deletion, but adds a new backend index/control surface and must avoid leaking private share graphs.
- Add delete choices for shared media: for example, "delete just this message" versus "delete this file everywhere it was shared". This is clearer to the user, but needs careful wording, permission rules, and a way to enumerate/delete all backend refs without exposing private recipient details.

Possible direction: store an opaque attachment id/ref index server-side, track every message that references it, and make deletion explicit. A normal delete removes only the selected message ref. A destructive delete removes the Storage object and tombstones or removes all message refs that point to it. This needs privacy review, UI copy, and backend enforcement before implementation.
