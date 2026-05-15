import { parseQuery } from './query.js';

const DEBOUNCE_MS = 300;

// A "source" wires a parser + a remote fetcher + result caching for the
// generic search hook. The profile source is the only one we have today;
// future sources (chats, transactions) would live alongside it.
export function createProfileSource({ remote, mode = 'profiles' }) {
    if (!remote?.byUsername || !remote?.byRole) {
        throw new Error('createProfileSource requires remote.byUsername and remote.byRole');
    }

    return ({ context }) => {
        const { user = {}, peer = {} } = context || {};
        const { uid, blockedSet } = user;
        const { addPeer } = peer;

        return {
            debounceMs: DEBOUNCE_MS,
            parse: (input) => parseQuery(input, { mode }),
            fetch: async (parsed) => {
                if (!parsed) return [];
                if (parsed.kind === 'username') {
                    if (!parsed.value) return [];
                    return remote.byUsername(parsed.value, { excludeUid: uid });
                }
                if (parsed.kind === 'role') {
                    return remote.byRole(parsed.role, { excludeUid: uid });
                }
                return [];
            },
            filter: (results) => {
                if (!blockedSet?.size) return results;
                return results.filter((profile) => !blockedSet.has(profile?.uid));
            },
            onResults: async (results) => {
                if (typeof addPeer !== 'function') return;
                await Promise.allSettled(
                    results.map(async (profile) => {
                        try {
                            await addPeer(profile);
                        } catch (error) {
                            console.error('search: addPeer failed:', error);
                        }
                    })
                );
            },
        };
    };
}
