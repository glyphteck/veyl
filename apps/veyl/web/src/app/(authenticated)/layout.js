import { requireSession } from '@/lib/routeguards';
import { BitcoinProvider } from '@/components/providers/bitcoinprovider';
import { AuthDialogHost, DialogProvider } from '@/components/providers/dialogprovider';

export default async function AuthenticatedLayout({ children }) {
    await requireSession();
    return (
        <DialogProvider>
            <BitcoinProvider>
                <AuthDialogHost>{children}</AuthDialogHost>
            </BitcoinProvider>
        </DialogProvider>
    );
}
