import { UserVaultProvider } from '@/components/providers/uservaultprovider';
import { requireVaultReady } from '@/lib/routeguards';

export default async function VaultLayout({ children }) {
    await requireVaultReady();
    return <UserVaultProvider>{children}</UserVaultProvider>;
}
