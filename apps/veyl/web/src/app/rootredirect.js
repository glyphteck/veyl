'use client';

import { useEffect } from 'react';
import { userAvatarCache } from '@/lib/useravatarcache';
import { replaceDocument } from '@/lib/documentnav';

export default function RootRedirect() {
    useEffect(() => {
        let active = true;

        async function send() {
            let target = '/landing';
            try {
                if (await userAvatarCache.hasRememberedAccount?.()) {
                    target = '/login';
                }
            } catch {
                target = '/landing';
            }
            if (active) {
                replaceDocument(target);
            }
        }

        void send();

        return () => {
            active = false;
        };
    }, []);

    return null;
}
