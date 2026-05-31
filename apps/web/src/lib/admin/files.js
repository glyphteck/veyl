'use client';

import { useEffect, useState } from 'react';
import { getDownloadURL, ref } from 'firebase/storage';
import { cleanText } from '@veyl/shared/utils/text';
import { getStorage } from '@/lib/firebase/firebaseclient';

const fileUrlCache = new Map();

function loadFileUrl(path) {
    const key = cleanText(path);
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

export function useFileUrl(path) {
    const [url, setUrl] = useState(null);

    useEffect(() => {
        let live = true;

        loadFileUrl(path).then((nextUrl) => {
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
