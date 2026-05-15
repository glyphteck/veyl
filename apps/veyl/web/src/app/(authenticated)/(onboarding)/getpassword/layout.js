import { requirePasswordStep } from '@/lib/routeguards';

export default async function GetPasswordLayout({ children }) {
    await requirePasswordStep();
    return children;
}
