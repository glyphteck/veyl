'use client';

import { useEffect } from 'react';
import RootRedirect from './rootredirect';
import { RootGate } from '@/lib/routeguards';
import { writePendingInviteFromLocation } from '@/lib/invite';

export default function RootClient() {
    useEffect(() => {
        writePendingInviteFromLocation();
    }, []);

    return <RootGate guest={<RootRedirect />} />;
}
