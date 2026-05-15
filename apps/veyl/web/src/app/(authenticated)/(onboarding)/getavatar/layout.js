import { requireAvatarStep } from '@/lib/routeguards';

export default async function GetAvatarLayout({ children }) {
    await requireAvatarStep();
    return children;
}
