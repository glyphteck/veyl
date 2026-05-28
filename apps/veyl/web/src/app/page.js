import { redirect } from 'next/navigation';
import RootRedirect from './rootredirect';
import { getOnboardingState, getRequestUser } from '@/lib/routeguards';

export const dynamic = 'force-dynamic';

export default async function Root() {
    const user = await getRequestUser();
    if (!user?.uid) return <RootRedirect />;

    const state = await getOnboardingState(user.uid);
    if (!state.hasUsername) redirect('/getusername');
    if (!state.hasAvatarEntry) redirect('/getavatar');
    if (!state.hasCurrentCommunityRules) redirect('/community');
    if (!state.hasSeed) redirect('/getpassword');
    redirect('/unlock');
}
