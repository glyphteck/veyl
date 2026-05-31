'use client';

import { useEffect } from 'react';
import { userAvatarCache } from '@/lib/user/avatarcache';

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
                window.location.replace(target);
            }
        }

        void send();

        return () => {
            active = false;
        };
    }, []);

    return null;
}
