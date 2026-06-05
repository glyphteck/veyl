'use client';

import { LOCAL_PROFILE_CACHE_MAX_AGE_MS, LOCAL_PROFILE_CACHE_MAX_ITEMS } from '../../config.js';
import { isObject, jsonClean } from './schema.js';

function isUsableProfile(profile, now = Date.now()) {
    if (!profile?.uid || (!profile.walletPK && !profile.chatPK)) {
        return false;
    }
    const lastUsedAt = Number(profile.lastUsedAt) || 0;
    return lastUsedAt > 0 && now - lastUsedAt <= LOCAL_PROFILE_CACHE_MAX_AGE_MS;
}

function pruneProfiles(profilesByUid, now = Date.now()) {
    if (!isObject(profilesByUid)) {
        return { profiles: [], next: {}, changed: false };
    }

    const profiles = Object.values(profilesByUid)
        .filter((profile) => isUsableProfile(profile, now))
        .sort((a, b) => {
            const delta = (Number(b.lastUsedAt) || 0) - (Number(a.lastUsedAt) || 0);
            if (delta !== 0) return delta;
            return String(a.uid || '').localeCompare(String(b.uid || ''));
        })
        .slice(0, LOCAL_PROFILE_CACHE_MAX_ITEMS);
    const next = {};
    for (const profile of profiles) {
        next[profile.uid] = profile;
    }

    return {
        profiles,
        next,
        changed: Object.keys(next).length !== Object.keys(profilesByUid).length,
    };
}

export function readCachedProfiles(cache) {
    const profilesByUid = cache?.read?.()?.profilesByUid;
    const { profiles, next, changed } = pruneProfiles(profilesByUid);
    if (changed && cache?.patch) {
        void cache.patch((payload) => {
            payload.profilesByUid = next;
            return payload;
        });
    }
    return profiles;
}

export function writeCachedProfiles(cache, profiles) {
    if (!cache?.patch || !Array.isArray(profiles)) {
        return;
    }

    void cache.patch((payload) => {
        const now = Date.now();
        for (const profile of profiles) {
            if (!profile?.uid || (!profile.walletPK && !profile.chatPK)) {
                continue;
            }
            const previous = payload.profilesByUid[profile.uid] || {};
            payload.profilesByUid[profile.uid] = jsonClean({
                ...previous,
                ...profile,
                lastUsedAt: now,
            });
        }
        payload.profilesByUid = pruneProfiles(payload.profilesByUid, now).next;
        return payload;
    });
}
