import { useEffect, useRef } from 'react';

import { markDiag, markDone } from '../utils/diagnostics.js';

export function useWalletPrivacy({ wallet, ghostWallet, diag }) {
    const desiredPrivacyRef = useRef(ghostWallet);
    const privacySyncRef = useRef(Promise.resolve());

    useEffect(() => {
        desiredPrivacyRef.current = ghostWallet;
    }, [ghostWallet]);

    useEffect(() => {
        if (!wallet || typeof wallet.setPrivacyEnabled !== 'function') {
            return;
        }

        let cancelled = false;
        privacySyncRef.current = privacySyncRef.current
            .catch(() => {})
            .then(async () => {
                const startedAt = Date.now();
                const desired = desiredPrivacyRef.current === true;
                markDiag(diag, 'wallet.privacy.start', { ghostWallet: desired });
                const current = typeof wallet.getWalletSettings === 'function' ? await wallet.getWalletSettings() : null;
                if (cancelled || (current?.privateEnabled === true) === desired) {
                    markDone(diag, 'wallet.privacy', startedAt, { changed: false, cancelled: !!cancelled });
                    return;
                }

                await wallet.setPrivacyEnabled(desired);
                markDone(diag, 'wallet.privacy', startedAt, { changed: true });
            })
            .catch((error) => {
                markDiag(diag, 'wallet.privacy.error', { code: error?.code || '', message: error?.message || String(error) });
                console.debug?.('could not update wallet privacy', error?.message ?? error);
            });

        return () => {
            cancelled = true;
        };
    }, [diag, wallet, ghostWallet]);
}
