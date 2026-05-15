import { redirectIfSession } from '@/lib/routeguards';

export default async function UnauthenticatedLayout({ children }) {
    await redirectIfSession();
    return children;
}
