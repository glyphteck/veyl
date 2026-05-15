import { requireAdmin } from '@/lib/routeguards';
import { AdminProvider } from '@/components/providers/adminprovider';

export default async function AdminLayout({ children }) {
    await requireAdmin();

    return <AdminProvider>{children}</AdminProvider>;
}
