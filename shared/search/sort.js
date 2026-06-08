import { cleanUsername } from '../username.js';

export function compareProfilesByUsername(a, b) {
    return (a?.username || '').localeCompare(b?.username || '');
}

export function compareProfilesByName(a, b) {
    return String(a?.username || a?.uid || '').localeCompare(String(b?.username || b?.uid || ''));
}

function usernameMatchRank(username, query) {
    if (username === query) return 0;
    if (username.startsWith(query)) return 1;
    const index = username.indexOf(query);
    return index >= 0 ? 2 + index : 100;
}

// Username searches rank exact, prefix, then substring matches.
// Role / key / browse searches just sort alphabetically by username.
export function sortProfiles(profiles = [], parsed) {
    const list = [...(profiles || [])];
    if (!parsed || parsed.kind !== 'username' || !parsed.value) {
        return list.sort(compareProfilesByUsername);
    }

    const q = parsed.value;
    return list.sort((a, b) => {
        const aN = cleanUsername(a?.username || '');
        const bN = cleanUsername(b?.username || '');
        const aRank = usernameMatchRank(aN, q);
        const bRank = usernameMatchRank(bN, q);
        if (aRank !== bRank) return aRank - bRank;
        return aN.localeCompare(bN);
    });
}
