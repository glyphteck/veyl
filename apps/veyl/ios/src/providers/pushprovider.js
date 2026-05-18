import { useCallback, useEffect, useRef } from 'react';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import { useWallet } from '@/providers/walletprovider';
import { useChat } from '@/providers/chatprovider';
import { dropPush, getPushState, setPush } from '@/lib/push';

Notifications.setNotificationHandler({
    handleNotification: async () => {
        const show = AppState.currentState !== 'active';

        return {
            shouldShowBanner: show,
            shouldShowList: show,
            shouldPlaySound: show,
            shouldSetBadge: false,
        };
    },
});

function getNotificationData(response) {
    const content = response?.notification?.request?.content;
    const data = content?.data;
    if (data && typeof data === 'object') {
        return data;
    }
    const payloadBody = response?.notification?.request?.trigger?.payload?.body;
    return payloadBody && typeof payloadBody === 'object' ? payloadBody : null;
}

function getChatId(response) {
    const data = getNotificationData(response);
    const chatId = typeof data?.chatId === 'string' ? data.chatId : null;
    return data?.type === 'chat' && chatId ? chatId : null;
}

function getWalletNotification(response) {
    const data = getNotificationData(response);
    return data?.type === 'wallet' ? data : null;
}

function readParam(value) {
    return Array.isArray(value) ? value[0] : value;
}

export function PushProvider({ children }) {
    const router = useRouter();
    const pathname = usePathname();
    const params = useGlobalSearchParams();
    const { uid, chatPK, chatBanned, settings, settingsReady } = useUser();
    const { lockState } = useVault();
    const { wallet, refresh: refreshWallet } = useWallet();
    const { selectChat } = useChat();
    const lastKeyRef = useRef(null);
    const pendingChatRef = useRef(null);
    const pendingWalletRef = useRef(null);
    const pendingWalletRefreshRef = useRef(false);
    const protectedAppReady = !!uid && lockState === 'unlocked' && settingsReady && typeof settings?.faceID === 'boolean';
    const walletReady = !!wallet;
    const activeChatId = pathname === '/currentchat' ? readParam(params?.id) : null;
    const activeWallet = pathname === '/wallet';

    const refreshWalletFromPush = useCallback(() => {
        if (!walletReady || typeof refreshWallet !== 'function') {
            pendingWalletRefreshRef.current = true;
            return;
        }

        pendingWalletRefreshRef.current = false;
        void refreshWallet().catch((error) => {
            console.warn('wallet push refresh failed', error);
        });
    }, [refreshWallet, walletReady]);

    const openChat = useCallback(
        (chatId, key = chatId) => {
            if (!chatId) {
                return;
            }

            const routeKey = key || chatId;
            if (!protectedAppReady) {
                pendingChatRef.current = { chatId, key: routeKey };
                pendingWalletRef.current = null;
                return;
            }

            if (chatBanned) {
                pendingChatRef.current = null;
                return;
            }

            pendingChatRef.current = null;
            pendingWalletRef.current = null;
            if (activeChatId === chatId) {
                lastKeyRef.current = routeKey;
                return;
            }

            if (lastKeyRef.current === routeKey) {
                return;
            }

            lastKeyRef.current = routeKey;
            selectChat?.(chatId);
            const href = { pathname: '/currentchat', params: { id: chatId } };
            if (activeChatId) {
                router.replace(href);
            } else {
                router.push(href);
            }
        },
        [activeChatId, chatBanned, protectedAppReady, router, selectChat]
    );

    const openWallet = useCallback(
        (key = 'wallet', { refresh = false } = {}) => {
            const routeKey = key || 'wallet';
            if (!protectedAppReady) {
                pendingWalletRef.current = { key: routeKey, refresh };
                pendingChatRef.current = null;
                return;
            }

            pendingWalletRef.current = null;
            pendingChatRef.current = null;
            if (activeWallet) {
                lastKeyRef.current = routeKey;
                if (refresh) {
                    refreshWalletFromPush();
                }
                return;
            }

            if (lastKeyRef.current === routeKey) {
                return;
            }

            lastKeyRef.current = routeKey;
            router.push('/wallet');
            if (refresh) {
                refreshWalletFromPush();
            }
        },
        [activeWallet, protectedAppReady, refreshWalletFromPush, router]
    );

    useEffect(() => {
        if (!protectedAppReady || chatBanned || !pendingChatRef.current) {
            return;
        }

        const { chatId, key } = pendingChatRef.current;
        pendingChatRef.current = null;
        openChat(chatId, key);
    }, [chatBanned, protectedAppReady, openChat]);

    useEffect(() => {
        if (!protectedAppReady || !pendingWalletRef.current) {
            return;
        }

        const pending = pendingWalletRef.current;
        pendingWalletRef.current = null;
        openWallet(pending.key, { refresh: pending.refresh });
    }, [protectedAppReady, openWallet]);

    useEffect(() => {
        if (!protectedAppReady || !walletReady || !pendingWalletRefreshRef.current) {
            return;
        }

        refreshWalletFromPush();
    }, [protectedAppReady, refreshWalletFromPush, walletReady]);

    useEffect(() => {
        const sub = Notifications.addNotificationResponseReceivedListener((response) => {
            const key = response?.notification?.request?.identifier;
            const walletNotification = getWalletNotification(response);
            if (walletNotification) {
                openWallet(key ?? 'wallet', { refresh: true });
                return;
            }

            const chatId = getChatId(response);
            openChat(chatId, key ?? chatId);
        });

        void Notifications.getLastNotificationResponseAsync()
            .then((response) => {
                const key = response?.notification?.request?.identifier;
                const walletNotification = getWalletNotification(response);
                if (walletNotification) {
                    openWallet(key ?? 'wallet', { refresh: true });
                    return;
                }

                const chatId = getChatId(response);
                openChat(chatId, key ?? chatId);
            })
            .catch(() => {});

        return () => {
            sub.remove();
        };
    }, [openChat, openWallet]);

    useEffect(() => {
        if (!uid || !chatPK) {
            return;
        }

        let dead = false;

        const sync = async (devicePushToken) => {
            try {
                const push = await getPushState(devicePushToken);
                if (dead) {
                    return;
                }

                if (push.status === 'disabled') {
                    await dropPush().catch(() => {});
                    return;
                }

                if (push.status !== 'ready' || (!push.token && !push.nativeToken)) {
                    return;
                }

                await setPush(push.token, uid, push.meta, push.nativeToken);
            } catch (error) {
                console.warn('push sync failed', error);
            }
        };

        void sync();

        const sub = Notifications.addPushTokenListener((devicePushToken) => {
            // Expo warns against refetching the native token inside this listener.
            void sync(devicePushToken);
        });

        return () => {
            dead = true;
            sub.remove();
        };
    }, [chatPK, uid]);

    return children;
}
