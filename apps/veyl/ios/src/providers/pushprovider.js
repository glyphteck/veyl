import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useUser } from '@/providers/userprovider';
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

function getChatId(response) {
    const data = response?.notification?.request?.content?.data;
    const chatId = typeof data?.chatId === 'string' ? data.chatId : null;
    return data?.type === 'chat' && chatId ? chatId : null;
}

export function PushProvider({ children }) {
    const router = useRouter();
    const { uid, chatPK, chatBanned } = useUser();
    const lastKeyRef = useRef(null);
    const pendingChatRef = useRef(null);

    const openChat = useCallback(
        (chatId, key = chatId) => {
            if (!chatId) {
                return;
            }

            if (!uid) {
                pendingChatRef.current = chatId;
                return;
            }

            if (chatBanned) {
                pendingChatRef.current = null;
                return;
            }

            if (lastKeyRef.current === key) {
                return;
            }

            lastKeyRef.current = key;
            router.push({ pathname: '/currentchat', params: { id: chatId } });
        },
        [chatBanned, router, uid]
    );

    useEffect(() => {
        if (!uid || chatBanned || !pendingChatRef.current) {
            return;
        }

        const chatId = pendingChatRef.current;
        pendingChatRef.current = null;
        openChat(chatId);
    }, [chatBanned, uid, openChat]);

    useEffect(() => {
        const sub = Notifications.addNotificationResponseReceivedListener((response) => {
            const chatId = getChatId(response);
            const key = response?.notification?.request?.identifier ?? chatId;
            openChat(chatId, key);
        });

        void Notifications.getLastNotificationResponseAsync()
            .then((response) => {
                const chatId = getChatId(response);
                const key = response?.notification?.request?.identifier ?? chatId;
                openChat(chatId, key);
            })
            .catch(() => {});

        return () => {
            sub.remove();
        };
    }, [openChat]);

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

                if (push.status !== 'ready' || !push.token) {
                    return;
                }

                await setPush(push.token, uid);
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
