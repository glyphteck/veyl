# Encrypted User Data

status: active
branch: current
worktree: current
base: main@7d56e720d7e5
repo version: 0.14.6

## Scope

Move private user-owned server data behind vault-derived encryption.

Do not encrypt the existing `users/{uid}.settings` object wholesale. Some current settings are lock/device metadata that the app reads before the vault is unlocked. Split those first, then encrypt the private preference object.

## Open Items

- Split account preferences from lock/device metadata:
  - Device-local or lock metadata: Face ID enablement/staging and any pre-unlock route guards.
  - Encrypted server preferences: display currency, glass mode, autolock preferences, payment-behavior preferences, and future private UX preferences.
- Add a vault-derived settings key and encrypted settings payload using the shared body envelope.
- Load encrypted preferences after vault unlock and write them through a settings-specific cloud path.
- Remove plaintext server settings once the encrypted preference flow owns them.
- Audit whether blocked-user relationships can move to encrypted or blinded records without losing server-side abuse protection.
- Audit push device metadata. Push tokens must remain usable by the server, but extra device labels or notification preferences should not be plaintext by default.
- Audit wallet/public-key discovery settings. Public keys are routing/discovery data today, but any opt-in visibility or discovery preference should be encrypted.
