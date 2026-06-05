import { Alert, Animated, AppState, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { ChevronLeft, Clock3, Flag, History, UserX } from 'lucide-react-native';

import Avatar from '@/components/avatar';
import GlassHeader from '@/components/glass/glassheader';
import GlassIcon from '@/components/glass/glassicon';
import Icon from '@/components/icon';
import { cloud } from '@/lib/cloud';
import { useRouteLock } from '@/lib/navigation/routelock';
import { useTap } from '@/lib/tap';
import { useChat } from '@/providers/chatprovider';
import { usePeer } from '@/providers/peerprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { getChatPeerPK } from '@veyl/shared/chat/ids';
import { CHAT_RETENTION_24H, CHAT_RETENTION_SEEN, cleanChatRetention } from '@veyl/shared/chat/ttl';
import { textRouteParam } from '@veyl/shared/navigation/params';
import { cleanText } from '@veyl/shared/utils/text';
import { formatUserDisplay } from '@veyl/shared/profile';

function parsePeer(value) {
    const raw = textRouteParam(value).trim();
    if (!raw) return null;
    try {
        const peer = JSON.parse(raw);
        if (!peer || typeof peer !== 'object') return null;
        return {
            username: cleanText(peer.username) || null,
            uid: cleanText(peer.uid) || null,
            chatPK: cleanText(peer.chatPK) || null,
            walletPK: cleanText(peer.walletPK) || null,
            avatar: cleanText(peer.avatar) || null,
            active: !!peer.active,
            bot: !!peer.bot,
        };
    } catch {
        return null;
    }
}

function SectionDivider() {
    const { theme } = useTheme();

    return (
        <View style={{ paddingVertical: 6 }}>
            <View style={{ height: 1, backgroundColor: theme.border }} />
        </View>
    );
}

function SettingRow({ icon, label, description, onPress, right, disabled = false }) {
    const { theme } = useTheme();
    const tap = useTap({ onPress, disabled, drift: 1 });

    return (
        <Pressable {...tap.props} disabled={disabled}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}>
                <Animated.View style={{ transform: [{ scale: tap.scale }] }}>
                    <Icon icon={icon} size={26} color={theme.foreground} />
                </Animated.View>
                <View style={{ flex: 1, gap: description ? 2 : 0 }}>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: theme.foreground }}>{label}</Text>
                    {description ? <Text style={{ fontSize: 13, fontWeight: '500', lineHeight: 17, color: theme.muted }}>{description}</Text> : null}
                </View>
                {right ? <View style={{ alignSelf: 'center', alignItems: 'center', justifyContent: 'center' }}>{right}</View> : null}
            </View>
        </Pressable>
    );
}

export default function ChatSettingsRoute() {
    const { theme } = useTheme();
    const params = useLocalSearchParams();
    const navigation = useNavigation();
    const router = useRouter();
    const { blockPeer, chatPK: ownChatPK } = useUser();
    const { chats, dropChat, setChatTtl } = useChat() || {};
    const { peerByUsername, peerByUid, peerByChatPK, peerByWalletPK, addPeer, dropPeer } = usePeer() || {};
    const backTap = useTap({ onPress: router.back });
    const { lockRoute } = useRouteLock();
    const [fetchedPeer, setFetchedPeer] = useState(null);
    const [headerHeight, setHeaderHeight] = useState(0);

    const routePeer = useMemo(() => parsePeer(params?.peer), [params?.peer]);
    const chatId = textRouteParam(params?.chatId).trim();
    const username = routePeer?.username || '';
    const routeChatPK = routePeer?.chatPK || textRouteParam(params?.peerchatpk).trim() || textRouteParam(params?.chatPK).trim();
    const uid = routePeer?.uid || textRouteParam(params?.uid).trim();
    const walletPK = routePeer?.walletPK || textRouteParam(params?.walletPK).trim();

    const knownPeer = useMemo(() => {
        return (
            (username ? peerByUsername?.get(username) : null) ??
            (uid ? peerByUid?.get(uid) : null) ??
            (routeChatPK ? peerByChatPK?.get(routeChatPK) : null) ??
            (walletPK ? peerByWalletPK?.get(walletPK) : null) ??
            null
        );
    }, [peerByChatPK, peerByUid, peerByUsername, peerByWalletPK, routeChatPK, uid, username, walletPK]);

    const peer = useMemo(
        () =>
            knownPeer ??
            fetchedPeer ??
            routePeer ??
            (username || uid || routeChatPK || walletPK
                ? {
                      username: username || null,
                      uid: uid || null,
                      chatPK: routeChatPK || null,
                      walletPK: walletPK || null,
                  }
                : null),
        [fetchedPeer, knownPeer, routeChatPK, routePeer, uid, username, walletPK]
    );

    const title = useMemo(() => formatUserDisplay(peer || { username }), [peer, username]);
    const avatar = peer?.avatar ? { uri: peer.avatar } : null;
    const peerChatPK = peer?.chatPK || routeChatPK;
    const settingsChat = useMemo(() => {
        if (!Array.isArray(chats) || (!chatId && (!ownChatPK || !peerChatPK))) return null;
        return (
            chats.find((item) => {
                if (chatId && item?.id === chatId) return true;
                return !!(ownChatPK && peerChatPK && getChatPeerPK(item, ownChatPK) === peerChatPK);
            }) ?? null
        );
    }, [chatId, chats, ownChatPK, peerChatPK]);
    const settingsChatId = settingsChat?.id || chatId;
    const hasSettingsChat = !!settingsChat?.id;
    const currentRetention = cleanChatRetention(settingsChat?.settings?.retention);
    const [retention, setRetention] = useState(currentRetention);
    const [savingRetention, setSavingRetention] = useState(false);
    const serverRetentionRef = useRef(currentRetention);
    const pendingRetentionRef = useRef(currentRetention);
    const retentionChangedRef = useRef(false);
    const savingRetentionRef = useRef(null);
    const lastSettingsChatIdRef = useRef(settingsChatId);
    const settingsChatIdRef = useRef(settingsChatId);
    const savePendingRetentionRef = useRef(null);
    const openRef = useRef(true);

    useEffect(() => {
        const chatChanged = lastSettingsChatIdRef.current !== settingsChatId;
        lastSettingsChatIdRef.current = settingsChatId;
        settingsChatIdRef.current = settingsChatId;
        serverRetentionRef.current = currentRetention;

        if (chatChanged || !retentionChangedRef.current) {
            pendingRetentionRef.current = currentRetention;
            retentionChangedRef.current = false;
            setRetention(currentRetention);
        }
    }, [currentRetention, settingsChatId]);

    const savePendingRetention = useCallback(async () => {
        const nextRetention = cleanChatRetention(pendingRetentionRef.current);
        const savedRetention = cleanChatRetention(serverRetentionRef.current);
        const targetChatId = settingsChatIdRef.current;
        if (!targetChatId || !setChatTtl || !retentionChangedRef.current || nextRetention === savedRetention) {
            retentionChangedRef.current = false;
            return savedRetention;
        }
        if (savingRetentionRef.current) {
            return savingRetentionRef.current;
        }

        if (openRef.current) {
            setSavingRetention(true);
        }

        const save = setChatTtl(targetChatId, nextRetention)
            .then((confirmed) => {
                const confirmedRetention = cleanChatRetention(confirmed);
                serverRetentionRef.current = confirmedRetention;
                pendingRetentionRef.current = confirmedRetention;
                retentionChangedRef.current = false;
                if (openRef.current) {
                    setRetention(confirmedRetention);
                }
                return confirmedRetention;
            })
            .catch((error) => {
                pendingRetentionRef.current = serverRetentionRef.current;
                retentionChangedRef.current = false;
                if (openRef.current) {
                    setRetention(serverRetentionRef.current);
                }
                console.warn('chat settings update failed', error);
                throw error;
            })
            .finally(() => {
                savingRetentionRef.current = null;
                if (openRef.current) {
                    setSavingRetention(false);
                }
            });
        savingRetentionRef.current = save;
        return save;
    }, [setChatTtl]);

    useEffect(() => {
        savePendingRetentionRef.current = savePendingRetention;
    }, [savePendingRetention]);

    useEffect(() => {
        const appSub = AppState.addEventListener('change', (nextState) => {
            if (nextState !== 'active') {
                void savePendingRetentionRef.current?.().catch(() => {});
            }
        });
        const beforeRemoveSub = navigation.addListener('beforeRemove', () => {
            void savePendingRetentionRef.current?.().catch(() => {});
        });
        const blurSub = navigation.addListener('blur', () => {
            void savePendingRetentionRef.current?.().catch(() => {});
        });

        return () => {
            appSub?.remove?.();
            beforeRemoveSub?.();
            blurSub?.();
        };
    }, [navigation]);

    useEffect(() => {
        return () => {
            openRef.current = false;
            void savePendingRetentionRef.current?.().catch(() => {});
        };
    }, []);

    const handleRetentionToggle = useCallback(
        (value) => {
            if (!hasSettingsChat || !settingsChatId || !setChatTtl) return;
            const nextRetention = value ? CHAT_RETENTION_SEEN : CHAT_RETENTION_24H;
            pendingRetentionRef.current = nextRetention;
            retentionChangedRef.current = nextRetention !== serverRetentionRef.current;
            setRetention(nextRetention);
        },
        [hasSettingsChat, setChatTtl, settingsChatId]
    );

    useEffect(() => {
        if (knownPeer || !addPeer) return;
        const partial = {
            ...(username ? { username } : {}),
            ...(uid ? { uid } : {}),
            ...(routeChatPK ? { chatPK: routeChatPK } : {}),
            ...(walletPK ? { walletPK } : {}),
        };
        if (!Object.keys(partial).length) return;
        let cancelled = false;
        addPeer(partial)
            .then((nextPeer) => {
                if (!cancelled && nextPeer) setFetchedPeer(nextPeer);
            })
            .catch((error) => console.warn('peer lookup failed', error));
        return () => {
            cancelled = true;
        };
    }, [addPeer, knownPeer, routeChatPK, uid, username, walletPK]);

    const handleOpenHistory = useCallback(() => {
        const nextWalletPK = peer?.walletPK || walletPK;
        const nextChatPK = peer?.chatPK || routeChatPK;
        if (!nextWalletPK || !nextChatPK) {
            return;
        }
        if (!lockRoute()) return;
        router.push({
            pathname: '/history',
            params: {
                walletPK: nextWalletPK,
                chatPK: nextChatPK,
            },
        });
    }, [lockRoute, peer?.chatPK, peer?.walletPK, routeChatPK, router, walletPK]);

    const promptReportNote = useCallback((onSubmit) => {
        Alert.prompt(
            'Report user',
            'We will manually review this report and will have access to the content you are reporting.',
            [
                { text: 'cancel', style: 'cancel' },
                {
                    text: 'report',
                    style: 'destructive',
                    onPress: (value) => {
                        void onSubmit?.(value);
                    },
                },
            ],
            'plain-text'
        );
    }, []);

    const runReport = useCallback(
        async ({ nextUid, note }) => {
            try {
                await cloud.reports.submit({
                    uid: nextUid,
                    ...(note ? { note } : {}),
                });
                Alert.alert('Reported', 'We received the report.');
            } catch (error) {
                console.warn('report failed', error);
                Alert.alert('Report failed', error?.message || 'Could not submit this report.');
            }
        },
        []
    );

    const handleReportUser = useCallback(
        (note) => {
            const nextUid = peer?.uid || uid;
            if (!nextUid) return;
            const nextNote = typeof note === 'string' && note.trim() ? note.trim() : undefined;
            void runReport({ nextUid, note: nextNote });
        },
        [peer?.uid, runReport, uid]
    );

    const handleReport = useCallback(() => {
        const nextUid = peer?.uid || uid;
        if (!nextUid) return;
        Alert.alert('Report user?', 'We will manually review this report.', [
            { text: 'cancel', style: 'cancel' },
            { text: 'add note', onPress: () => promptReportNote(handleReportUser) },
            {
                text: 'report',
                style: 'destructive',
                onPress: () => handleReportUser(),
            },
        ]);
    }, [handleReportUser, peer?.uid, promptReportNote, uid]);

    const handleBlock = useCallback(() => {
        const nextUid = peer?.uid || uid;
        if (!nextUid) return;
        Alert.alert('Block user?', 'They will no longer be able to message you, and this chat will be removed from your list.', [
            { text: 'cancel', style: 'cancel' },
            {
                text: 'block',
                style: 'destructive',
                onPress: () => {
                    void (async () => {
                        try {
                            await blockPeer?.(peer || nextUid);
                            if (chatId) dropChat?.(chatId);
                            dropPeer?.(peer || nextUid);
                            router.back();
                        } catch (error) {
                            console.warn('block peer failed', error);
                            Alert.alert('Block failed', error?.message || 'Could not block this user.');
                        }
                    })();
                },
            },
        ]);
    }, [blockPeer, chatId, dropChat, dropPeer, peer, router, uid]);

    const expireAfterSeen = retention === CHAT_RETENTION_SEEN;
    const showChatSettings = hasSettingsChat && !!setChatTtl;
    const retentionDisabled = savingRetention || !hasSettingsChat || !setChatTtl;
    const switchProps = {
        trackColor: { false: theme.border, true: theme.active },
        thumbColor: theme.background,
        disabled: retentionDisabled,
    };

    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <ScrollView
                contentContainerStyle={{
                    paddingTop: headerHeight + 24,
                    paddingBottom: 56,
                    alignItems: 'stretch',
                }}
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                bounces
                alwaysBounceVertical
                directionalLockEnabled
                alwaysBounceHorizontal={false}
            >
                <View style={{ alignItems: 'center', paddingHorizontal: 24 }}>
                    <Avatar source={avatar} size={160} active={!!peer?.active} bot={!!peer?.bot} />
                    <View style={{ marginTop: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                        <GlassIcon glassEffectStyle="regular" rounded={16} icon={History} onPress={handleOpenHistory} disabled={!(peer?.walletPK || walletPK) || !(peer?.chatPK || routeChatPK)} />
                        <GlassIcon glassEffectStyle="regular" rounded={16} icon={UserX} onPress={handleBlock} disabled={!(peer?.uid || uid)} />
                        <GlassIcon glassEffectStyle="regular" rounded={16} icon={Flag} onPress={handleReport} disabled={!(peer?.uid || uid)} />
                    </View>
                </View>
                {showChatSettings ? (
                    <View style={{ marginTop: 30 }}>
                        <Text style={{ paddingHorizontal: 16, paddingBottom: 8, color: theme.foreground, fontSize: 26, fontWeight: '900' }}>settings</Text>
                        <SectionDivider />
                        <SettingRow
                            icon={Clock3}
                            label="expire after seen"
                            description="otherwise messages expire 24h after seen."
                            onPress={() => handleRetentionToggle(!expireAfterSeen)}
                            right={<Switch value={expireAfterSeen} onValueChange={handleRetentionToggle} {...switchProps} />}
                            disabled={retentionDisabled}
                        />
                    </View>
                ) : null}
            </ScrollView>
            <GlassHeader contentStyle={{ flexDirection: 'row', alignItems: 'center' }} onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
                <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                    <Pressable {...backTap.props} hitSlop={10} style={{ justifyContent: 'center' }}>
                        <Animated.View style={{ transform: [{ scale: backTap.scale }] }}>
                            <Icon icon={ChevronLeft} size={32} color={theme.foreground} />
                        </Animated.View>
                    </Pressable>
                </View>
                <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text numberOfLines={1} style={{ textAlign: 'center', color: theme.foreground, fontSize: 24, fontWeight: '900' }}>
                        {title}
                    </Text>
                </View>
                <View style={{ width: 56 }} />
            </GlassHeader>
        </View>
    );
}
