'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Loading from '@/components/loading';
import { cloud } from '@/lib/cloud';

const STEP_HREF = {
    username: '/getusername',
    avatar: '/getavatar',
    community: '/community',
    password: '/getpassword',
};
let leavingAuth = false;
let onboardingRefreshKey = 0;
const onboardingRefreshListeners = new Set();

export function refreshOnboardingState() {
    onboardingRefreshKey += 1;
    for (const listener of onboardingRefreshListeners) {
        listener(onboardingRefreshKey);
    }
}

function useAuthUser() {
    const [state, setState] = useState({ ready: false, user: null });

    useEffect(() => cloud.auth.watch((user) => setState({ ready: true, user })), []);

    return state;
}

function useOnboardingRefreshKey() {
    const [key, setKey] = useState(onboardingRefreshKey);

    useEffect(() => {
        onboardingRefreshListeners.add(setKey);
        return () => {
            onboardingRefreshListeners.delete(setKey);
        };
    }, []);

    return key;
}

function leaveAuth() {
    if (typeof window === 'undefined' || leavingAuth) return;
    leavingAuth = true;
    replaceDocument('/');
}

function replaceDocument(href) {
    if (typeof window === 'undefined') return;
    window.location.replace(href);
}

export function hrefForOnboardingState(state) {
    if (!state?.hasUsername) return STEP_HREF.username;
    if (!state.hasAvatarEntry) return STEP_HREF.avatar;
    if (!state.hasCurrentCommunityRules) return STEP_HREF.community;
    if (!state.hasVault) return STEP_HREF.password;
    return '/unlock';
}

function useOnboardingState(user, enabled) {
    const [state, setState] = useState({ loading: false, uid: null, value: null, error: null });
    const refreshKey = useOnboardingRefreshKey();

    useEffect(() => {
        if (!enabled || !user?.uid) {
            setState({ loading: false, uid: null, value: null, error: null });
            return;
        }

        let active = true;
        setState({ loading: true, uid: user.uid, value: null, error: null });

        cloud.user.onboarding(user.uid)
            .then((value) => {
                if (active) setState({ loading: false, uid: user.uid, value, error: null });
            })
            .catch((error) => {
                if (active) setState({ loading: false, uid: user.uid, value: null, error });
            });

        return () => {
            active = false;
        };
    }, [enabled, refreshKey, user?.uid]);

    return {
        ...state,
        loading: !!enabled && (state.loading || state.uid !== user?.uid),
    };
}

export function AuthGate({ children }) {
    const { ready, user } = useAuthUser();

    useEffect(() => {
        if (ready && !user) {
            leaveAuth();
        }
    }, [ready, user]);

    if (!ready || !user) return <Loading />;
    return children;
}

export function GuestGate({ children }) {
    const { ready, user } = useAuthUser();

    useEffect(() => {
        if (ready && user) {
            replaceDocument('/');
        }
    }, [ready, user]);

    if (!ready || user) return <Loading />;
    return children;
}

export function RootGate({ guest }) {
    const router = useRouter();
    const { ready, user } = useAuthUser();
    const onboarding = useOnboardingState(user, ready && !!user);

    useEffect(() => {
        if (!ready || !user || onboarding.loading) return;

        if (onboarding.error) {
            router.replace('/');
            return;
        }

        router.replace(hrefForOnboardingState(onboarding.value));
    }, [onboarding.error, onboarding.loading, onboarding.value, ready, router, user]);

    if (!ready) return <Loading />;
    if (!user) return guest ?? null;
    return <Loading />;
}

export function OnboardingGate({ step, children }) {
    const router = useRouter();
    const { ready, user } = useAuthUser();
    const onboarding = useOnboardingState(user, ready && !!user);
    const currentHref = STEP_HREF[step] || STEP_HREF.username;
    const targetHref = onboarding.value ? hrefForOnboardingState(onboarding.value) : null;
    const shouldRedirect = !!targetHref && targetHref !== currentHref;

    useEffect(() => {
        if (onboarding.error) {
            router.replace('/');
            return;
        }

        if (shouldRedirect) {
            router.replace(targetHref);
        }
    }, [onboarding.error, router, shouldRedirect, targetHref]);

    if (!ready || !user || onboarding.loading || onboarding.error || shouldRedirect) return <Loading />;
    return children;
}

export function VaultReadyGate({ children }) {
    const router = useRouter();
    const { ready, user } = useAuthUser();
    const onboarding = useOnboardingState(user, ready && !!user);
    const targetHref = onboarding.value ? hrefForOnboardingState(onboarding.value) : null;
    const shouldRedirect = !!targetHref && targetHref !== '/unlock';

    useEffect(() => {
        if (onboarding.error) {
            router.replace('/');
            return;
        }

        if (shouldRedirect) {
            router.replace(targetHref);
        }
    }, [onboarding.error, router, shouldRedirect, targetHref]);

    if (!ready || !user || onboarding.loading || onboarding.error || shouldRedirect) return <Loading />;
    return children;
}

export function AdminGate({ children }) {
    const router = useRouter();
    const { ready, user } = useAuthUser();
    const [adminState, setAdminState] = useState({ loading: false, allowed: false });

    useEffect(() => {
        if (!ready || !user?.uid) {
            setAdminState({ loading: false, allowed: false });
            return;
        }

        let active = true;
        setAdminState({ loading: true, allowed: false });

        cloud.user.admin.is(user.uid)
            .then((allowed) => {
                if (active) setAdminState({ loading: false, allowed });
            })
            .catch(() => {
                if (active) setAdminState({ loading: false, allowed: false });
            });

        return () => {
            active = false;
        };
    }, [ready, user?.uid]);

    useEffect(() => {
        if (ready && user && !adminState.loading && !adminState.allowed) {
            router.replace('/wallet');
        }
    }, [adminState.allowed, adminState.loading, ready, router, user]);

    if (!ready || !user || adminState.loading || !adminState.allowed) return <Loading />;
    return children;
}
