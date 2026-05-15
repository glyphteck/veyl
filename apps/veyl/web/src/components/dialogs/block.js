'use client';

import { useState } from 'react';
import { Loader } from 'lucide-react';
import { formatUserDisplay } from '@/lib/utils';
import Alert from './alert';

export default function Block({ data, close }) {
    const peer = data?.peer ?? null;
    const onConfirm = data?.onConfirm;
    const onCancel = data?.onCancel ?? close;
    const [busy, setBusy] = useState(false);

    const handleBlock = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await onConfirm?.();
        } catch {
            // handled by caller
        } finally {
            setBusy(false);
            close?.();
        }
    };

    return (
        <Alert title={`block ${formatUserDisplay(peer, true)}?`} onCancel={onCancel} onConfirm={handleBlock} busy={busy} confirmLabel={busy ? '' : 'block'} confirmIcon={busy ? <Loader className="size-4 animate-spin" /> : null}>
            <p className="text-muted">They will no longer be able to message you, and this chat will be removed from your list.</p>
        </Alert>
    );
}
