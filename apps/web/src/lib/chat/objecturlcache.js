'use client';

function isPromise(value) {
    return !!value && typeof value.then === 'function';
}

export function revokeObjectUrl(value) {
    if (typeof value !== 'string' || !value.startsWith('blob:')) {
        return;
    }

    try {
        URL.revokeObjectURL(value);
    } catch {}
}

export function createObjectUrlCache({ max = 16 } = {}) {
    const entries = new Map();
    let epoch = 0;

    const getReady = (key) => {
        const entry = entries.get(key);
        return entry?.status === 'ready' ? entry : null;
    };

    const trim = () => {
        while (entries.size > max) {
            let dropKey = null;
            let dropEntry = null;
            let dropPriority = Infinity;

            for (const [key, entry] of entries.entries()) {
                if (entry?.status !== 'ready' || Number(entry.refs) > 0) {
                    continue;
                }
                const priority = Number(entry.priority) || 0;
                if (priority < dropPriority) {
                    dropKey = key;
                    dropEntry = entry;
                    dropPriority = priority;
                }
            }

            if (!dropKey) {
                return;
            }

            entries.delete(dropKey);
            revokeObjectUrl(dropEntry?.url);
        }
    };

    const setReady = (key, url, options = {}) => {
        const previous = getReady(key);
        if (previous?.url && previous.url !== url) {
            revokeObjectUrl(previous.url);
        }

        if (options.touch) {
            entries.delete(key);
        }
        entries.set(key, {
            status: 'ready',
            url,
            refs: previous?.refs ?? 0,
            priority: Math.max(Number(previous?.priority) || 0, Number(options.priority) || 0),
        });
        trim();
        return url;
    };

    return {
        get epoch() {
            return epoch;
        },
        get(key) {
            return entries.get(key) ?? null;
        },
        getReady,
        getReadyUrl(key, options = {}) {
            const entry = getReady(key);
            if (!entry?.url) {
                return '';
            }
            if (options.touch) {
                entries.delete(key);
                entries.set(key, entry);
            }
            return entry.url;
        },
        getPendingPromise(key) {
            const entry = entries.get(key);
            return entry?.status === 'pending' && isPromise(entry.promise) ? entry.promise : null;
        },
        retain(key) {
            const entry = getReady(key);
            if (!entry) {
                return '';
            }
            entries.set(key, { ...entry, refs: Number(entry.refs) + 1 });
            return entry.url;
        },
        release(key) {
            const entry = getReady(key);
            if (!entry) {
                return;
            }
            entries.set(key, { ...entry, refs: Math.max(0, Number(entry.refs) - 1) });
        },
        setPending(key, promise, fields = {}) {
            entries.set(key, {
                status: 'pending',
                promise,
                ...fields,
            });
        },
        setReady,
        delete(key) {
            const entry = entries.get(key);
            if (entry?.status === 'ready') {
                revokeObjectUrl(entry.url);
            }
            entries.delete(key);
        },
        clear() {
            epoch += 1;
            for (const entry of entries.values()) {
                if (entry?.status === 'ready') {
                    revokeObjectUrl(entry.url);
                }
            }
            entries.clear();
        },
    };
}
