'use client';

import { UserProvider } from '@/components/providers/userprovider';
import { VaultProvider } from '@/components/providers/vaultprovider';
import { ChatProvider } from '@/components/providers/chatprovider';
import { CloakProvider } from '@glyphteck/shared/providers/cloakprovider';

export function UserVaultProvider({ children }) {
    return (
        <UserProvider>
            <VaultProvider>
                <ChatProvider>
                    <CloakProvider>{children}</CloakProvider>
                </ChatProvider>
            </VaultProvider>
        </UserProvider>
    );
}
