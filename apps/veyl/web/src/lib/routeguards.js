import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasCurrentCommunityRules } from '@glyphteck/shared/community';
import admin, { verifySession } from '@/lib/firebase/firebaseadmin';

async function getSessionCookie() {
    return (await cookies()).get('session')?.value || null;
}

export async function getRequestUser() {
    const session = await getSessionCookie();
    if (!session) return null;

    const uid = await verifySession(session);
    return uid ? { uid } : null;
}

export async function getSessionUid() {
    return (await getRequestUser())?.uid || null;
}

export async function requireSession() {
    const user = await getRequestUser();
    if (!user?.uid) redirect('/login');
    return user.uid;
}

export async function requireAdmin() {
    const uid = await requireSession();
    const snap = await admin.firestore().collection('admins').doc(uid).get();
    if (!snap.exists) {
        redirect('/wallet');
    }
    return uid;
}

export async function redirectIfSession(path = '/unlock') {
    if (await getSessionUid()) redirect(path);
}

export async function getOnboardingState(uid) {
    const nextUid = uid || (await requireSession());
    const [profileDoc, seedDoc, userDoc] = await Promise.all([
        admin.firestore().collection('profiles').doc(nextUid).get(),
        admin.firestore().collection('seeds').doc(nextUid).get(),
        admin.firestore().collection('users').doc(nextUid).get(),
    ]);
    const profile = profileDoc.exists ? profileDoc.data() : null;
    const user = userDoc.exists ? userDoc.data() : null;

    return {
        uid: nextUid,
        hasUsername: !!profile?.username,
        hasSeed: seedDoc.exists,
        communityRulesVersion: user?.communityRulesVersion || null,
        communityRulesDate: user?.communityRulesDate || null,
        communityRulesAcceptedAt: user?.communityRulesAcceptedAt || null,
        hasCurrentCommunityRules: hasCurrentCommunityRules(user),
    };
}

export async function requireVaultReady(uid) {
    const state = await getOnboardingState(uid);
    if (!state.hasUsername) redirect('/getusername');
    if (!state.hasCurrentCommunityRules) redirect('/community');
    if (!state.hasSeed) redirect('/getpassword');
    return state;
}

export async function requireUsernameStep() {
    const state = await getOnboardingState();
    if (state.hasUsername) {
        if (state.hasSeed && !state.hasCurrentCommunityRules) redirect('/community');
        redirect(state.hasSeed ? '/unlock' : '/getavatar');
    }
    return state;
}

export async function requireAvatarStep() {
    const state = await getOnboardingState();
    if (!state.hasUsername) redirect('/getusername');
    if (state.hasSeed) redirect(state.hasCurrentCommunityRules ? '/unlock' : '/community');
    return state;
}

export async function requireCommunityStep() {
    const state = await getOnboardingState();
    if (!state.hasUsername) redirect('/getusername');
    if (state.hasCurrentCommunityRules) redirect(state.hasSeed ? '/unlock' : '/getpassword');
    return state;
}

export async function requirePasswordStep() {
    const state = await getOnboardingState();
    if (!state.hasUsername) redirect('/getusername');
    if (!state.hasCurrentCommunityRules) redirect('/community');
    if (state.hasSeed) redirect('/unlock');
    return state;
}
