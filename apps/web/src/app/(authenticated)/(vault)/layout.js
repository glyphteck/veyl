'use client';

import { UserVaultProvider } from '@/components/providers/uservaultprovider';
import { VaultReadyGate } from '@/lib/routeguards';

export default function VaultLayout({ children }) {
    return (
        <VaultReadyGate>
            <UserVaultProvider>{children}</UserVaultProvider>
        </VaultReadyGate>
    );
}
