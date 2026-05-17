# Media Message Sharing

## Deletion And Shared File Privacy

Sharing by reference improves upload/download efficiency, but it creates a deletion contract problem: if the original message owner deletes their message, deleting the Storage object breaks every forwarded reference, while keeping it means the file still exists on the backend after the user tried to delete it.

The product needs an explicit design before this becomes final behavior. Users should be able to understand whether deleting a media message only removes that chat message or removes the backend file wherever it was shared. They also need a way to truly remove sensitive media from the backend when that is their intent.

Tradeoffs:

- Keep shared Storage objects until all refs disappear: preserves forwarded messages, but can conflict with a user's expectation that delete means the file is gone.
- Delete the Storage object when the source message is deleted: honors strong deletion intent, but breaks every recipient's forwarded message and cached-download assumptions.
- Reupload or copy on share: gives each shared message independent deletion semantics, but loses the efficiency goal and creates more backend storage churn.
- Track refs centrally: enables ref-aware deletion, but adds a new backend index/control surface and must avoid leaking private share graphs.
- Add delete choices for shared media: for example, "delete just this message" versus "delete this file everywhere it was shared". This is clearer to the user, but needs careful wording, permission rules, and a way to enumerate/delete all backend refs without exposing private recipient details.

Possible direction: store an opaque attachment id/ref index server-side, track every message that references it, and make deletion explicit. A normal delete removes only the selected message ref. A destructive delete removes the Storage object and tombstones or removes all message refs that point to it. This needs privacy review, UI copy, and backend enforcement before implementation.
