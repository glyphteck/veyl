'use client';

import { useEffect, useState } from 'react';
import { getDownloadURL, ref } from 'firebase/storage';
import { getStorage } from '@/lib/firebase/firebaseclient';

const fileUrlCache = new Map();

export function loadAdminFileUrl(path) {
    const key = typeof path === 'string' ? path.trim() : '';
    if (!key) {
        return Promise.resolve(null);
    }

    if (!fileUrlCache.has(key)) {
        const storage = getStorage();
        fileUrlCache.set(
            key,
            getDownloadURL(ref(storage, key)).catch(() => null)
        );
    }

    return fileUrlCache.get(key);
}

export function useAdminFile(path) {
    const [url, setUrl] = useState(null);

    useEffect(() => {
        let live = true;

        loadAdminFileUrl(path).then((nextUrl) => {
            if (live) {
                setUrl(nextUrl || null);
            }
        });

        return () => {
            live = false;
        };
    }, [path]);

    return url;
}
