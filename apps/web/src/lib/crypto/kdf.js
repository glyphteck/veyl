let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
    if (worker) {
        return worker;
    }
    if (typeof Worker === 'undefined') {
        throw new Error('vault kdf worker unavailable');
    }

    worker = new Worker(new URL('./kdfworker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
        const { id, key, error } = event.data || {};
        const item = pending.get(id);
        if (!item) {
            return;
        }

        pending.delete(id);
        if (error) {
            item.reject(new Error(error));
            return;
        }

        item.resolve(new Uint8Array(key));
    };
    worker.onerror = (event) => {
        const error = new Error(event?.message || 'vault kdf worker failed');
        for (const item of pending.values()) {
            item.reject(error);
        }
        pending.clear();
        worker?.terminate?.();
        worker = null;
    };
    return worker;
}

export function deriveVaultKey(password, salt, params) {
    const id = nextId++;
    const saltBytes = new Uint8Array(salt);

    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
            getWorker().postMessage({ id, password, salt: saltBytes.buffer, params }, [saltBytes.buffer]);
        } catch (error) {
            pending.delete(id);
            reject(error);
        }
    });
}
