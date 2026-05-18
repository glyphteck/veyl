'use client';

import { useEffect, useRef, useState } from 'react';
import { DIALOG_CLOSE_MS } from '@/components/dialog';
import Alert from './alert';
import { logout } from '@/lib/useractions';
import { userAvatarCache } from '@/lib/useravatarcache';

export default function RememberAccount({ data, close }) {
    const [busy, setBusy] = useState(false);
    const [ready, setReady] = useState(false);
    const logoutStartedRef = useRef(false);
    const account = data?.user || null;
    const uid = account?.uid || null;

    useEffect(() => {
        let cancelled = false;

        async function checkRemembered() {
            if (!uid) {
                if (!cancelled) {
                    setReady(true);
                }
                return;
            }
            try {
                if (await userAvatarCache.hasRemembered?.(uid)) {
                    if (!cancelled) {
                        setBusy(true);
                    }
                    try {
                        await logout({ remember: true, account });
                    } catch (error) {
                        console.error('logout failed', error);
                        if (!cancelled) {
                            setBusy(false);
                            setReady(true);
                        }
                    }
                    return;
                }
            } catch (error) {
                console.warn('failed to check remembered account', error);
            }
            if (!cancelled) {
                setReady(true);
            }
        }

        void checkRemembered();
        return () => {
            cancelled = true;
        };
    }, [account, uid]);

    const choose = (remember) => {
        if (logoutStartedRef.current) return;
        logoutStartedRef.current = true;
        close?.();
        window.setTimeout(() => {
            logout({ remember, account }).catch((error) => {
                console.error('logout failed', error);
                logoutStartedRef.current = false;
            });
        }, DIALOG_CLOSE_MS);
    };

    if (!ready) return null;

    return (
        <Alert title="remember account?" cancelLabel="no thanks" confirmLabel="remember" confirmClassName="button-fill" onCancel={() => choose(false)} onConfirm={() => choose(true)} busy={busy}>
            <p className="text-sm font-bold text-muted">login faster next time</p>
        </Alert>
    );
}
