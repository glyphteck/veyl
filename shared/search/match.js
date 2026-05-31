import { cleanUsername } from '../username.js';
import { getRole } from './roles.js';

// Decides whether a locally cached profile matches a parsed query.
// Used during local + remote merging so we only render relevant matches.
export function matchesProfile(profile, parsed) {
    if (!parsed || !profile) return false;

    if (parsed.kind === 'username') {
        if (!parsed.value) return true;
        return cleanUsername(profile.username || '').startsWith(parsed.value);
    }

    if (parsed.kind === 'role') {
        const role = getRole(parsed.role);
        return role ? !!role.matches(profile) : false;
    }

    if (parsed.kind === 'key') {
        return profile.chatPK === parsed.value || profile.walletPK === parsed.value;
    }

    return false;
}
