import { argon2idAsync } from '@noble/hashes/argon2.js';

self.onmessage = async (event) => {
    const { id, password, salt, params } = event.data || {};

    try {
        const key = await argon2idAsync(password, new Uint8Array(salt), {
            t: params.t,
            m: params.m,
            p: params.p,
            dkLen: params.dkLen,
            version: params.version,
            asyncTick: 10,
        });

        self.postMessage({ id, key }, [key.buffer]);
    } catch (error) {
        self.postMessage({ id, error: error?.message || String(error) });
    }
};
