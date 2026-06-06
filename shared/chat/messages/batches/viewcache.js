import { CHAT_MESSAGE_VIEW_CACHE_SIZE } from '../../../config.js';

export function createMessageViewCache(limit = CHAT_MESSAGE_VIEW_CACHE_SIZE) {
    const views = new Map();
    const active = new Map();
    let owner = '';

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
        while (views.size > limit) {
            const oldest = views.keys().next().value;
            if (!oldest) {
                return;
            }
            views.delete(oldest);
        }
    }

    return {
        clear,
        resetOwner,
        get(scopeKey) {
            return scopeKey ? views.get(scopeKey) ?? null : null;
        },
        remember(scopeKey, seed) {
            if (!scopeKey || !seed?.ready) {
                return;
            }

            views.delete(scopeKey);
            views.set(scopeKey, seed);
            trim();
        },
        update(scopeKey, update) {
            if (!scopeKey || typeof update !== 'function') {
                return null;
            }
            const seed = views.get(scopeKey);
            if (!seed) {
                return null;
            }
            const next = update(seed);
            if (!next) {
                views.delete(scopeKey);
                return null;
            }
            views.set(scopeKey, next);
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
