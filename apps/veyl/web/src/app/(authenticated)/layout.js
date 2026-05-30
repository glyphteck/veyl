'use client';

import { AuthGate } from '@/lib/routeguards';
import { BitcoinProvider } from '@/components/providers/bitcoinprovider';
import { AuthDialogHost, DialogProvider } from '@/components/providers/dialogprovider';

export default function AuthenticatedLayout({ children }) {
    return (
        <AuthGate>
            <DialogProvider>
                <BitcoinProvider>
                    <AuthDialogHost>{children}</AuthDialogHost>
                </BitcoinProvider>
            </DialogProvider>
        </AuthGate>
    );
}
