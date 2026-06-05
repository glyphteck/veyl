'use client';

import { useEffect, useState } from 'react';
import { cleanText } from '@veyl/shared/utils/text';
import { cloud } from '@/lib/cloud';

const fileUrlCache = new Map();

function loadFileUrl(path) {
    const key = cleanText(path);
    if (!key) {
        return Promise.resolve(null);
    }

    if (!fileUrlCache.has(key)) {
        fileUrlCache.set(
            key,
            cloud.admin.reports.evidence.path(key).catch(() => null)
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
