// A "role" is a category of profile the user can search for with `@<role>`.
// Each role owns its local match check. Backend query details live in the
// active cloud adapter.

export const ROLES = {
    bots: {
        id: 'bots',
        aliases: ['bot'],
        matches: (profile) => !!profile?.bot,
    },
    active: {
        id: 'active',
        aliases: ['online'],
        matches: (profile) => !!profile?.active,
    },
};

const ROLE_BY_TOKEN = (() => {
    const map = {};
    for (const role of Object.values(ROLES)) {
        map[role.id] = role.id;
        for (const alias of role.aliases || []) map[alias] = role.id;
    }
    return map;
})();

export function resolveRole(token) {
    return token ? ROLE_BY_TOKEN[token] || null : null;
}

export function isRole(token) {
    return !!resolveRole(token);
}

export function getRole(token) {
    const id = resolveRole(token);
    return id ? ROLES[id] : null;
}

export function listRoles() {
    return Object.keys(ROLES);
}
