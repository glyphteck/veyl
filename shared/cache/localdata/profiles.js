'use client';

import { isObject, jsonClean } from './schema.js';

export function readCachedProfiles(cache) {
    const profiles = cache?.read?.()?.profilesByUid;
    return isObject(profiles) ? Object.values(profiles).filter((profile) => profile?.uid) : [];
}

export function writeCachedProfiles(cache, profiles) {
    if (!cache?.patch || !Array.isArray(profiles)) {
        return;
    }

    void cache.patch((payload) => {
        for (const profile of profiles) {
            if (!profile?.uid || (!profile.walletPK && !profile.chatPK)) {
                continue;
            }
            const previous = payload.profilesByUid[profile.uid] || {};
            payload.profilesByUid[profile.uid] = jsonClean({
                ...previous,
                ...profile,
                savedAt: Date.now(),
            });
        }
        return payload;
    });
}
