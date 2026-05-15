import { requireUsernameStep } from '@/lib/routeguards';

export default async function GetUsernameLayout({ children }) {
    await requireUsernameStep();
    return children;
}
