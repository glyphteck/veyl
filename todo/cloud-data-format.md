# Cloud Data Format

status: active
branch: current
worktree: current

## Scope

Backend-owned storage encoding for encrypted app blobs.

The client owns encryption and decryption. The backend/cloud adapter owns how encrypted bytes are represented at rest and on the wire.

## Open Items

- `shared/crypto/pack.js` still imports Firestore `Bytes`.
- Decide whether cloud adapters should store encrypted blob values as `Uint8Array`, base64/base64url strings, or a small packed-byte wrapper.
- Keep encryption logic backend-neutral; only the cloud adapter should care whether the current backend stores bytes as Firestore `Bytes`, SQL bytea/blob, object bytes, or encoded text.

