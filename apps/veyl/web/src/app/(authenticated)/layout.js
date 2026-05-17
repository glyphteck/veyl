import { requireSession } from '@/lib/routeguards';
import { AuthDialogHost, DialogProvider } from '@/components/providers/dialogprovider';

export default async function AuthenticatedLayout({ children }) {
    await requireSession();
    return (
        <DialogProvider>
            <AuthDialogHost>{children}</AuthDialogHost>
        </DialogProvider>
    );
}
