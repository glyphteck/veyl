import { redirect } from 'next/navigation';
import { getRequestUser } from '@/lib/routeguards';

export const dynamic = 'force-dynamic';

export default async function Root() {
    !(await getRequestUser()) ? redirect('/login') : redirect('/unlock');
}
