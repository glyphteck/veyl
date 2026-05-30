'use client';

import { GuestGate } from '@/lib/routeguards';

export default function UnauthenticatedLayout({ children }) {
    return <GuestGate>{children}</GuestGate>;
}
