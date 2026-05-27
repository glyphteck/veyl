import { cleanUsername, MAX_USERNAME } from '../regex.js';
import { resolveRole } from './roles.js';

// Parses a raw input string into a typed query object that downstream search
// code can act on without re-parsing.
//
// Modes:
//   'mainmenu' — only `@`-prefixed input engages profile search; bare text is
//                ignored so the main menu can filter local actions itself.
//   'profiles' — the field is profile-only; bare text is treated as a username
//                and `@<role>` triggers a role search.
//
// Output shape: null OR { kind, value, role?, raw }
//   kind 'username' — { value: cleanUsername, raw }       (value '' = browse mode)
//   kind 'role'     — { value: roleId, role: roleId, raw }
//   kind 'key'      — { value, raw }                      (length > MAX_USERNAME)
export function parseQuery(input, { mode = 'profiles' } = {}) {
    const raw = String(input ?? '').trim().toLowerCase();
    if (!raw) return null;

    const hasPrefix = raw.startsWith('@');
    if (mode === 'mainmenu' && !hasPrefix) return null;

    const stripped = hasPrefix ? raw.slice(1) : raw;
    // Bare `@` is browse-mode in mainmenu (show all users); meaningless elsewhere.
    if (!stripped) return mode === 'mainmenu' ? { kind: 'username', value: '', raw } : null;

    if (hasPrefix) {
        const role = resolveRole(stripped);
        if (role) return { kind: 'role', value: role, role, raw };
    }

    if (stripped.length > MAX_USERNAME) {
        return { kind: 'key', value: stripped, raw };
    }

    const value = cleanUsername(stripped);
    if (!value) return null;
    return { kind: 'username', value, raw };
}

export function queryKey(parsed) {
    return parsed ? `${parsed.kind}:${parsed.value}` : '';
}
