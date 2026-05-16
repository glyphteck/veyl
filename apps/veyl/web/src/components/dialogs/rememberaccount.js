'use client';

import { useState } from 'react';
import Alert from './alert';
import { logout } from '@/lib/useractions';

export default function RememberAccount({ data }) {
    const [busy, setBusy] = useState(false);
    const account = data?.user || null;

    const choose = async (remember) => {
        if (busy) return;
        setBusy(true);
        try {
            await logout({ remember, account });
        } catch (error) {
            console.error('logout failed', error);
            setBusy(false);
        }
    };

    return (
        <Alert title="remember account?" cancelLabel="no thanks" confirmLabel="remember" confirmClassName="button-fill" onCancel={() => choose(false)} onConfirm={() => choose(true)} busy={busy}>
            <p className="text-sm font-bold text-muted">login faster next time</p>
        </Alert>
    );
}
