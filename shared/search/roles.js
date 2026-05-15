import { collection, limit, query, where } from 'firebase/firestore';

// A "role" is a category of profile the user can search for with `@<role>`.
// Each role owns its local predicate and its Firestore query so adding a new
// role is one entry here and zero changes anywhere else.

const ROLE_LIMIT = 15;

export const ROLES = {
    bots: {
        id: 'bots',
        aliases: ['bot'],
        predicate: (profile) => !!profile?.bot,
        buildQuery: (db) => query(collection(db, 'profiles'), where('bot', '!=', false), limit(ROLE_LIMIT)),
    },
    active: {
        id: 'active',
        aliases: ['online'],
        predicate: (profile) => !!profile?.active,
        buildQuery: (db) => query(collection(db, 'profiles'), where('active', '==', true), limit(ROLE_LIMIT)),
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
