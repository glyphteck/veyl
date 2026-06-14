import { CHAT_MESSAGE_VIEW_CACHE_SIZE } from '../../../config.js';

export function createMessageViewCache(limit = CHAT_MESSAGE_VIEW_CACHE_SIZE) {
    const views = new Map();
    const active = new Map();
    let owner = '';

    function makeRuntime() {
        return {
            decrypted: new Map(),
            held: new Map(),
            visibleKeys: new Set(),
            deletedKeys: new Set(),
            derived: null,
        };
    }

    function normalizeEntry(value) {
        if (value?.runtime) {
            return value;
        }
        return {
            seed: value?.ready ? value : null,
            runtime: makeRuntime(),
        };
    }

    function getEntry(scopeKey, create = false) {
        if (!scopeKey) {
            return null;
        }
        const current = views.get(scopeKey);
        if (current) {
            const entry = normalizeEntry(current);
            if (entry !== current) {
                views.set(scopeKey, entry);
            }
            return entry;
        }
        if (!create) {
            return null;
        }
        const entry = normalizeEntry(null);
        views.set(scopeKey, entry);
        trim();
        return entry;
    }

    function clear() {
        views.clear();
        active.clear();
    }

    function resetOwner(nextOwner) {
        const value = nextOwner || '';
        if (!value) {
            if (owner) {
                owner = '';
                clear();
            }
            return false;
        }

        if (owner !== value) {
            owner = value;
            clear();
        }
        return true;
    }

    function trim() {
        let scanned = 0;
        while (views.size > limit && scanned < views.size) {
            const oldest = views.keys().next().value;
            if (!oldest) {
                return;
            }
            if (active.has(oldest)) {
                const value = views.get(oldest);
                views.delete(oldest);
                views.set(oldest, value);
                scanned += 1;
                continue;
            }
            views.delete(oldest);
            scanned = 0;
        }
    }

    return {
        clear,
        resetOwner,
        get(scopeKey) {
            return getEntry(scopeKey)?.seed ?? null;
        },
        runtime(scopeKey) {
            return getEntry(scopeKey, true)?.runtime ?? null;
        },
        remember(scopeKey, seed) {
            if (!scopeKey || !seed?.ready) {
                return;
            }

            const entry = getEntry(scopeKey, true);
            entry.seed = seed;
            views.delete(scopeKey);
            views.set(scopeKey, entry);
            trim();
        },
        update(scopeKey, update) {
            if (!scopeKey || typeof update !== 'function') {
                return null;
            }
            const entry = getEntry(scopeKey);
            if (!entry?.seed) {
                return null;
            }
            const next = update(entry.seed);
            if (!next) {
                views.delete(scopeKey);
                return null;
            }
            entry.seed = next;
            views.set(scopeKey, entry);
            trim();
            return next;
        },
        retain(scopeKey) {
            if (!scopeKey) {
                return;
            }
            active.set(scopeKey, (active.get(scopeKey) || 0) + 1);
        },
        release(scopeKey, onLeave) {
            if (!scopeKey) {
                return;
            }

            const count = (active.get(scopeKey) || 1) - 1;
            if (count > 0) {
                active.set(scopeKey, count);
                return;
            }

            active.delete(scopeKey);
            onLeave?.();
        },
    };
}
