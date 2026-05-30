'use client';

import { AdminGate } from '@/lib/routeguards';
import { AdminProvider } from '@/components/providers/adminprovider';

export default function AdminLayout({ children }) {
    return (
        <AdminGate>
            <AdminProvider>{children}</AdminProvider>
        </AdminGate>
    );
}
