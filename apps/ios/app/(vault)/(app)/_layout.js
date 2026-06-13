import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { writeResumeTarget } from '@veyl/shared/cache/localdata';
import { invite } from '@veyl/shared/invite';
import { resumeTargetFromPath } from '@veyl/shared/navigation/resume';
import { canSendOnScan } from '@veyl/shared/settings';
import { useTheme } from '@/providers/themeprovider';
import { useChat } from '@/providers/chatprovider';
import { usePeer } from '@/providers/peerprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import { dropPendingInvite, readPendingInvite } from '@/lib/invite';
import { dropPendingQrIntent, qrIntent, readPendingQrIntent } from '@/lib/qrintent';
import { mark } from '@/lib/diagnostics';
import { stackScreenOptions } from '@/lib/navigation/stackoptions';

export const unstable_settings = {
    initialRouteName: '(home)',
};

const SHEET_ROUTES = new Set(['userscan', 'fundwallet', 'fundinginfo', 'withdraw', 'withdrawalinfo', 'transfer', 'peerselector', 'sendphoto', 'sharemedia']);

function PendingInviteHandler() {
    const router = useRouter();
    const user = useUser();
    const { selectPeerChat } = useChat();
    const { addPeer } = usePeer();
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) return;
        handledRef.current = true;

        async function run() {
            const pending = await readPendingInvite();
            if (!pending) return;

            const addInvitePeer = async (value) => {
                if (!addPeer) return null;
                try {
                    return await addPeer(value);
                } catch {
                    return null;
                }
            };
            const peerByInvite = async () => {
                if (pending.walletPK) return await addInvitePeer({ walletPK: pending.walletPK });
                if (pending.from && pending.from !== user.username) return await addInvitePeer({ username: pending.from });
                return null;
            };

            if ([invite.chat, invite.send, invite.media].includes(pending.kind) && pending.from && pending.from !== user.username) {
                const peer = await addInvitePeer({ username: pending.from });
                if (peer?.chatPK) {
                    await selectPeerChat?.(peer.chatPK);
                    router.replace({
                        pathname: '/chat/[peerchatpk]',
                        params: { peerchatpk: peer.chatPK },
                    });
                }
            }

            if (pending.kind === invite.request) {
                const peer = await peerByInvite();
                const walletPK = peer?.walletPK ?? pending.walletPK;
                if (!walletPK) return;
                router.replace({
                    pathname: '/transfer',
                    params: {
                        ...(peer?.uid ? { uid: peer.uid } : {}),
                        walletPK,
                        ...(pending.amount ? { amount: pending.amount } : {}),
                        send: '1',
                    },
                });
            }

            await dropPendingInvite();
        }

        run().catch((error) => {
            console.warn('pending invite failed', error);
            void dropPendingInvite();
        });
    }, [addPeer, router, selectPeerChat, user.username]);

    return null;
}

function PendingQrIntentHandler() {
    const router = useRouter();
    const pathname = usePathname();
    const user = useUser();
    const { addPeer } = usePeer();

    useEffect(() => {
        if (pathname.startsWith('/qr')) return;

        let cancelled = false;

        async function run() {
            const pending = await readPendingQrIntent();
            if (!pending || cancelled) return;

            await dropPendingQrIntent();
            if (cancelled) return;

            if (pending.kind === qrIntent.payment) {
                const auto = canSendOnScan(user.settings) && !!pending.amount;

                if (pending.invoice && pending.invoiceType) {
                    let peer = null;
                    if (pending.walletPK || pending.username) {
                        try {
                            peer = await addPeer?.(pending.walletPK ? { walletPK: pending.walletPK } : { username: pending.username });
                        } catch (error) {
                            console.warn('pending invoice peer lookup failed', error);
                        }
                    }

                    router.push({
                        pathname: '/transfer',
                        params: {
                            invoiceType: pending.invoiceType,
                            invoice: pending.invoice,
                            ...(peer?.uid ? { uid: peer.uid } : {}),
                            ...(peer?.username || pending.username ? { username: peer?.username ?? pending.username } : {}),
                            ...(peer?.walletPK || pending.walletPK ? { walletPK: peer?.walletPK ?? pending.walletPK } : {}),
                            ...(pending.amount ? { amount: pending.amount, send: '1', auto: auto ? '1' : '0' } : { send: '1' }),
                        },
                    });
                    return;
                }

                if (pending.walletPK && pending.walletPK !== user.walletPK) {
                    let peer = null;
                    try {
                        peer = await addPeer?.({ walletPK: pending.walletPK });
                    } catch (error) {
                        console.warn('pending qr peer lookup failed', error);
                    }

                    router.push({
                        pathname: '/transfer',
                        params: {
                            uid: peer?.uid ?? '',
                            walletPK: peer?.walletPK ?? pending.walletPK,
                            ...(pending.amount ? { amount: pending.amount, send: '1', auto: auto ? '1' : '0' } : { send: '1' }),
                        },
                    });
                    return;
                }
            }

            if (pending.kind === qrIntent.withdraw && pending.address) {
                router.push({ pathname: '/withdraw', params: { address: pending.address } });
            }
        }

        run()
            .catch((error) => {
                console.warn('pending qr intent failed', error);
                void dropPendingQrIntent();
            });

        return () => {
            cancelled = true;
        };
    }, [addPeer, pathname, router, user.settings, user.walletPK]);

    return null;
}

export default function AppLayout() {
    const { theme } = useTheme();
    const pathname = usePathname();
    const { localCache, lockState } = useVault();
    const cacheRef = useRef(localCache);
    const pathnameRef = useRef(pathname);
    const lastTargetRef = useRef(null);
    const unlockedRef = useRef(lockState === 'unlocked');
    const wasUnlockedRef = useRef(lockState === 'unlocked');
    cacheRef.current = localCache;
    pathnameRef.current = pathname;
    unlockedRef.current = lockState === 'unlocked';

    useEffect(() => {
        const target = resumeTargetFromPath(pathname);
        if (!target) return;
        lastTargetRef.current = target;
    }, [pathname]);

    const saveCurrentRoute = useCallback((options = {}) => {
        if (!options.force && !unlockedRef.current) return;
        const cache = cacheRef.current;
        const target = lastTargetRef.current || resumeTargetFromPath(pathnameRef.current);
        if (!target) return;
        mark('route.cache.write', { route: target.route, reason: options.reason || 'leave' });
        writeResumeTarget(cache, target);
        void cache?.flush?.();
    }, []);

    useEffect(() => {
        const sub = AppState.addEventListener('change', (nextState) => {
            if (nextState !== 'active') saveCurrentRoute({ reason: nextState });
        });

        return () => {
            saveCurrentRoute({ reason: 'unmount' });
            sub?.remove?.();
        };
    }, [saveCurrentRoute]);

    useEffect(() => {
        if (wasUnlockedRef.current && lockState !== 'unlocked') {
            saveCurrentRoute({ force: true, reason: 'lock' });
        }
        wasUnlockedRef.current = lockState === 'unlocked';
    }, [lockState, saveCurrentRoute]);

    return (
        <>
            <PendingInviteHandler />
            <PendingQrIntentHandler />
            <Stack screenOptions={stackScreenOptions(theme, SHEET_ROUTES)}>
                <Stack.Screen name="(home)" options={{ animationTypeForReplace: 'pop' }} />
                <Stack.Screen name="community" />
                <Stack.Screen name="exportwallet" />
                <Stack.Screen name="blocked" />
                <Stack.Screen name="legal" />
                <Stack.Screen
                    name="chat/[peerchatpk]/index"
                    options={{
                        freezeOnBlur: true,
                    }}
                />
                <Stack.Screen name="chat/[peerchatpk]/settings" />
                <Stack.Screen name="history" />
                <Stack.Screen
                    name="userscan"
                    options={{
                        presentation: 'formSheet',
                        sheetGrabberVisible: true,
                        sheetAllowedDetents: 'fitToContents',
                        contentStyle: { backgroundColor: 'transparent' },
                    }}
                />
                <Stack.Screen
                    name="fundwallet"
                    options={{
                        presentation: 'formSheet',
                        sheetGrabberVisible: true,
                        sheetAllowedDetents: 'fitToContents',
                        contentStyle: { backgroundColor: 'transparent' },
                    }}
                />
                <Stack.Screen
                    name="fundinginfo"
                    options={{
                        presentation: 'formSheet',
                        sheetGrabberVisible: true,
                        sheetAllowedDetents: 'fitToContents',
                        contentStyle: { backgroundColor: 'transparent' },
                    }}
                />
                <Stack.Screen
                    name="withdraw"
                    options={{
                        presentation: 'formSheet',
                        sheetGrabberVisible: true,
                        sheetAllowedDetents: 'fitToContents',
                        contentStyle: { backgroundColor: 'transparent' },
                    }}
                />
                <Stack.Screen
                    name="withdrawalinfo"
                    options={{
                        presentation: 'formSheet',
                        sheetGrabberVisible: true,
                        sheetAllowedDetents: 'fitToContents',
                        contentStyle: { backgroundColor: 'transparent' },
                    }}
                />
                <Stack.Screen name="deleteaccount" />
                <Stack.Screen
                    name="transfer"
                    options={{
                        presentation: 'formSheet',
                        sheetGrabberVisible: true,
                        sheetAllowedDetents: 'fitToContents',
                        contentStyle: { backgroundColor: 'transparent' },
                    }}
                />
                <Stack.Screen
                    name="peerselector"
                    options={{
                        presentation: 'formSheet',
                        sheetGrabberVisible: true,
                        sheetAllowedDetents: [1],
                        contentStyle: { backgroundColor: theme?.background },
                    }}
                />
                <Stack.Screen
                    name="sendphoto"
                    options={{
                        presentation: 'formSheet',
                        sheetGrabberVisible: true,
                        sheetAllowedDetents: [1],
                        contentStyle: { backgroundColor: theme?.background },
                    }}
                />
                <Stack.Screen
                    name="sharemedia"
                    options={{
                        presentation: 'formSheet',
                        sheetGrabberVisible: true,
                        sheetAllowedDetents: [1],
                        contentStyle: { backgroundColor: theme?.background },
                    }}
                />
            </Stack>
        </>
    );
}
