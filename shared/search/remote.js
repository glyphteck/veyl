import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { SEARCH_USERNAME_LIMIT } from '../config.js';
import { hasPeerKeys } from '../profile.js';
import { compareProfilesByUsername } from './sort.js';
import { getRole } from './roles.js';

const USERNAME_LIMIT = SEARCH_USERNAME_LIMIT;

// Firestore-backed profile queries. The peer api supplies the doc->profile
// adapter and the cache writer so this layer doesn't need to know how peers
// are shaped or stored.
export function createProfileQueries({ db, createProfileFromDoc, cachePeer }) {
    if (!db || typeof createProfileFromDoc !== 'function' || typeof cachePeer !== 'function') {
        throw new Error('createProfileQueries requires db, createProfileFromDoc, and cachePeer');
    }

    function collect(snapshot, excludeUid) {
        const out = [];
        for (const doc of snapshot.docs) {
            if (doc.id === excludeUid) continue;
            const next = createProfileFromDoc(doc);
            if (!hasPeerKeys(next)) continue;
            const cached = cachePeer(next);
            if (cached) out.push({ ...cached });
        }
        return out;
    }

    async function byUsername(value, { excludeUid } = {}) {
        if (!value) return [];
        const snapshot = await getDocs(
            query(
                collection(db, 'profiles'),
                where('username', '>=', value),
                where('username', '<=', value + '\uf8ff'),
                orderBy('username'),
                limit(USERNAME_LIMIT)
            )
        );
        return collect(snapshot, excludeUid);
    }

    async function byRole(roleId, { excludeUid } = {}) {
        const role = getRole(roleId);
        if (!role) return [];
        const snapshot = await getDocs(role.buildQuery(db));
        const profiles = collect(snapshot, excludeUid);
        return profiles.sort(compareProfilesByUsername);
    }

    return { byUsername, byRole };
}
