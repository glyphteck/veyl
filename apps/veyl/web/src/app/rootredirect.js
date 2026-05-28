'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { userAvatarCache } from '@/lib/useravatarcache';

export default function RootRedirect() {
    const router = useRouter();

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
                router.replace(target);
            }
        }

        void send();

        return () => {
            active = false;
        };
    }, [router]);

    return null;
}
