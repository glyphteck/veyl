import { matchesProfile } from './match.js';
import { sortProfiles } from './sort.js';

// Merges already-loaded local peers with freshly-fetched remote results,
// dedupes by uid, drops the current user, applies an optional consumer-side
// filter, and returns a sorted list. Local peers are matched against the
// parsed query; remote results are trusted (they were matched server-side).
export function mergeProfiles({ local = [], remote = [], parsed, excludeUid, extraFilter } = {}) {
    if (!parsed) return [];

    const seen = new Set();
    const out = [];
    const tryAdd = (profile, requireMatch) => {
        if (!profile?.uid || profile.uid === excludeUid) return;
        if (extraFilter && !extraFilter(profile)) return;
        if (requireMatch && !matchesProfile(profile, parsed)) return;
        if (seen.has(profile.uid)) return;
        seen.add(profile.uid);
        out.push(profile);
    };

    for (const profile of local) tryAdd(profile, true);
    for (const profile of remote) tryAdd(profile, false);

    return sortProfiles(out, parsed);
}
