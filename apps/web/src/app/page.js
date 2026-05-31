'use client';

import RootRedirect from './rootredirect';
import { RootGate } from '@/lib/routeguards';

export default function Root() {
    return <RootGate guest={<RootRedirect />} />;
}
