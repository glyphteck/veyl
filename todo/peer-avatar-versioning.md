# Peer Avatar Versioning

## Problem

Some iOS peer avatar surfaces reload or stay on the default avatar until that exact surface has rendered, even when the same peer image was already visible in a chat row during the same session.

The current direct-interaction refresh path is a likely cause:

- `apps/veyl/ios/app/(vault)/(app)/currentchat.js` calls `updatePeer(peerProfile.uid, { refreshAvatar: true })` when the current chat opens.
- `shared/peers.js` treats `refreshAvatar` as a forced Storage URL refresh and appends a time-based cache-bust query.
- The avatar source string changes even when the avatar bytes did not change.
- `apps/veyl/ios/src/components/avatar.js` correctly gates image display on `expo-image` load for the current source key, so a new cache-busted source has to load before the header avatar appears.

The refresh is still useful because peer profile data can become stale. The bug is that profile refresh and avatar image refresh are coupled.

## Goal

Opening current chat should refresh peer metadata without changing the avatar image source unless the peer actually changed or removed their avatar.

The same rule should apply anywhere `updatePeer(..., { refreshAvatar: true })` is used: refresh the peer profile, compare avatar metadata, and only fetch or rerender the avatar when the profile says the avatar changed.

## Proposed Data Model

Add public avatar state to `profiles/{uid}`:

- `avatarVersion`: monotonic integer, starting at `0`.
- `hasAvatar`: boolean.

Use versioning instead of timestamps. It avoids clock issues, gives clients a stable render key, and lets peer caches compare one small profile field before touching Storage.

`hasAvatar` is needed because version alone cannot distinguish a missing avatar from an unchanged avatar without probing Storage.

## Backend Plan

Keep profile writes server-owned. Do not loosen Firestore rules so clients can write arbitrary profile metadata.

Preferred implementation:

- Add Firebase Storage avatar object triggers for `{uid}/avatar.webp`.
- On finalize/upload, update `profiles/{uid}` with `hasAvatar: true` and `avatarVersion: FieldValue.increment(1)`.
- On delete, update `profiles/{uid}` with `hasAvatar: false` and `avatarVersion: FieldValue.increment(1)`.
- If the profile no longer exists during account deletion, ignore the trigger rather than recreating the profile.
- Initialize new profile docs with `hasAvatar: false` and `avatarVersion: 0` when username/profile setup creates `profiles/{uid}`.
- Make bot/admin avatar deletion flow rely on the same Storage delete path so avatar bans also bump the version.

If Storage triggers are too much for the first pass, a callable that runs after successful avatar upload/delete can mark the version change, but that is easier to desync if the callable fails after Storage succeeds. Prefer the trigger unless there is a concrete blocker.

## Shared Client Plan

Update `shared/peers.js` first because iOS and web both consume this peer cache:

- Include `avatarVersion` and `hasAvatar` in `createProfileFromDoc`, cached profiles, and assembled peers.
- Keep cached avatar URLs stable while `avatarVersion` is unchanged.
- Change `refreshAvatar` semantics so it means "refresh profile and check avatar metadata", not "force a new avatar URL".
- In `updatePeerByUID`, compare cached `avatarVersion` and `hasAvatar` against the freshly fetched profile doc.
- Only call `getAvatarUrl(..., { force: true })` when `hasAvatar` is true and `avatarVersion` changed or the cached URL is missing.
- If `hasAvatar` is false, clear the cached avatar URL without probing Storage.
- Use the version as the cache key/query key, such as `?v=${avatarVersion}`, instead of `Date.now()`.
- Return `null` from `updatePeerByUID` when only a no-op profile refresh happened, so `peerRefreshTick` does not rerender avatar consumers.

Keep `shared/localdatacache.js` profile persistence as the durable peer-profile cache, but make sure the cached profile payload keeps `avatarVersion` and `hasAvatar`.

For profiles already cached without those fields, treat the avatar state as unknown and do one best-effort metadata refresh on direct interaction. After the profile has version fields, stop Storage probing unless the version changes.

## User Provider Plan

Apply the same version rule to the current user path in `shared/providers/userprovider.js`:

- Subscribe to `avatarVersion` and `hasAvatar` from the current user's profile doc.
- Fetch the current user's avatar only when `hasAvatar` is true and the version changed or the local avatar URL is missing.
- Clear `user.avatar` when `hasAvatar` is false.
- Stop appending `Date.now()` on normal profile snapshots.
- After a local avatar upload, keep the immediate local preview behavior on iOS, then let the profile version update settle the canonical URL.

## iOS UI Plan

Do not add local loading state to current chat to mask the issue.

The shared `Avatar` component is already doing the right visual behavior: default silhouette stays visible until the current `sourceKey` has loaded. The fix is to keep `sourceKey` stable when the avatar did not change.

After the shared peer cache is fixed, leave the current chat interaction refresh in place:

- `currentchat.js` may still call `updatePeer(peerProfile.uid, { refreshAvatar: true })`.
- That call should update active/name/key metadata and only change `peerProfile.avatar` if `avatarVersion` or `hasAvatar` changed.

## Verification

Manual iOS checks:

- Start a fresh session, open the chat list, confirm a peer avatar is visible in the row, then open current chat. The top-right avatar should appear from the same cached source without a new default-avatar delay when the peer avatar did not change.
- Change that peer's avatar from another session or client, then open current chat. The header and row should update to the new image once the profile version changes.
- Delete or avatar-ban that peer's avatar. Cached peer surfaces should clear to the default avatar after the profile version changes.
- Check the peer detail route, chat rows, wallet/history peer rows, and read-receipt avatars for the same stable behavior.

Code checks:

- Confirm `shared/peers.js` is the only place that decides whether a peer avatar URL needs a forced Storage refresh.
- Confirm `Date.now()` is not used as a peer avatar source key except for a deliberately local self-preview path, if any remains.
- Confirm profile writes for avatar metadata remain server-owned.
