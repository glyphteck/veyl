import { requireSession } from '@/lib/routeguards';
import { DialogProvider } from '@/components/providers/dialogprovider';

export default async function AuthenticatedLayout({ children }) {
    await requireSession();
    return <DialogProvider allow={['passwordrules']}>{children}</DialogProvider>;
}
