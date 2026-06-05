import { hasPeerKeys } from '../profile.js';
import { compareProfilesByUsername } from './sort.js';
import { getRole } from './roles.js';

// Cloud-backed profile queries. The peer api supplies the record->profile
// adapter and the cache writer so this layer doesn't need to know how peers
// are shaped or stored.
export function createProfileQueries({ cloud, createProfileFromRecord, cachePeer }) {
    if (!cloud || typeof createProfileFromRecord !== 'function' || typeof cachePeer !== 'function') {
        throw new Error('createProfileQueries requires cloud, createProfileFromRecord, and cachePeer');
    }

    function collect(records, excludeUid) {
        const out = [];
        for (const record of records || []) {
            if (record.uid === excludeUid) continue;
            const next = createProfileFromRecord(record);
            if (!hasPeerKeys(next)) continue;
            const cached = cachePeer(next);
            if (cached) out.push({ ...cached });
        }
        return out;
    }

    async function byUsername(value, { excludeUid } = {}) {
        if (!value) return [];
        const records = await cloud.search.peer.byUsernamePrefix(value);
        return collect(records, excludeUid);
    }

    async function byRole(roleId, { excludeUid } = {}) {
        const role = getRole(roleId);
        if (!role) return [];
        const records = await cloud.search.peer.byRole(role.id);
        const profiles = collect(records, excludeUid);
        return profiles.sort(compareProfilesByUsername);
    }

    return { byUsername, byRole };
}
