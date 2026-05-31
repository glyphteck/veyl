import { cleanUsername } from '../username.js';

export function compareProfilesByUsername(a, b) {
    return (a?.username || '').localeCompare(b?.username || '');
}

export function compareProfilesByName(a, b) {
    return String(a?.username || a?.uid || '').localeCompare(String(b?.username || b?.uid || ''));
}

// Username searches rank exact prefix matches first, then alphabetical.
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
        const aE = aN === q;
        const bE = bN === q;
        if (aE !== bE) return aE ? -1 : 1;
        const aP = aN.startsWith(q);
        const bP = bN.startsWith(q);
        if (aP !== bP) return aP ? -1 : 1;
        return aN.localeCompare(bN);
    });
}
