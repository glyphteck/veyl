import { requireCommunityStep } from '@/lib/routeguards';

export default async function CommunityLayout({ children }) {
    await requireCommunityStep();
    return children;
}
