import { devError, devLog } from './devlog.js';

function safeUid(uid) {
    if (typeof uid !== 'string' || !uid) {
        return 'anon';
    }
    return `${uid.slice(0, 8)}:${uid.length}`;
}

function dataKeys(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return [];
    }
    return Object.keys(data).sort();
}

function errorCode(error) {
    return error?.code || error?.details?.code || '';
}

function errorMessage(error) {
    return error?.message || String(error || 'error');
}

export function loggedCall(name, handler) {
    return async (context) => {
        const startedAt = Date.now();
        const auth = safeUid(context?.auth?.uid);
        devLog('[fn] start', { name, auth, keys: dataKeys(context?.data) });
        try {
            const result = await handler(context);
            devLog('[fn] done', { name, auth, elapsedMs: Date.now() - startedAt });
            return result;
        } catch (error) {
            devError('[fn] error', {
                name,
                auth,
                elapsedMs: Date.now() - startedAt,
                code: errorCode(error),
                message: errorMessage(error),
            });
            throw error;
        }
    };
}
