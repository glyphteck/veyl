import { Alert, Animated, Pressable, Text, View } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Flag, History, UserX } from 'lucide-react-native';
import { httpsCallable } from 'firebase/functions';

import Avatar from '@/components/avatar';
import GlassHeader from '@/components/glass/glassheader';
import GlassIcon from '@/components/glass/glassicon';
import Icon from '@/components/icon';
import { functions } from '@/lib/firebase';
import { useTap } from '@/lib/tap';
import { useChat } from '@/providers/chatprovider';
import { usePeer } from '@/providers/peerprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { formatUserDisplay } from '@glyphteck/shared/utils';

function pick(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value[0] || '';
    return '';
}

export default function PeerRoute() {
    const { theme } = useTheme();
    const params = useLocalSearchParams();
    const router = useRouter();
    const { blockPeer } = useUser();
    const { dropChat } = useChat() || {};
    const { peers, addPeer, dropPeer } = usePeer() || {};
    const backTap = useTap({ onPress: router.back });
    const routeLockRef = useRef(false);
    const routeLockTimerRef = useRef(null);
    const submitReport = useMemo(() => httpsCallable(functions, 'submitReport'), []);
    const [fetchedPeer, setFetchedPeer] = useState(null);
    const [headerHeight, setHeaderHeight] = useState(0);

    const username = pick(params?.username).trim();
    const chatId = pick(params?.chatId).trim();
    const chatPK = pick(params?.chatPK).trim();
    const uid = pick(params?.uid).trim();
    const walletPK = pick(params?.walletPK).trim();

    const knownPeer = useMemo(() => {
        if (!Array.isArray(peers)) return null;
        return (
            peers.find(
                (peer) =>
                    (username && peer?.username === username) ||
                    (uid && peer?.uid === uid) ||
                    (chatPK && peer?.chatPK === chatPK) ||
                    (walletPK && peer?.walletPK === walletPK)
            ) ?? null
        );
    }, [chatPK, peers, uid, username, walletPK]);

    const peer = useMemo(
        () =>
            knownPeer ??
            fetchedPeer ??
            (username || uid || chatPK || walletPK
                ? {
                      username: username || null,
                      uid: uid || null,
                      chatPK: chatPK || null,
                      walletPK: walletPK || null,
                  }
                : null),
        [chatPK, fetchedPeer, knownPeer, uid, username, walletPK]
    );

    const title = useMemo(() => formatUserDisplay(peer || { username }), [peer, username]);
    const avatar = peer?.avatar ? { uri: peer.avatar } : null;

    const lockRoute = useCallback((ms = 1200) => {
        if (routeLockRef.current) return false;
        routeLockRef.current = true;
        if (routeLockTimerRef.current) clearTimeout(routeLockTimerRef.current);
        routeLockTimerRef.current = setTimeout(() => {
            routeLockRef.current = false;
            routeLockTimerRef.current = null;
        }, ms);
        return true;
    }, []);

    useEffect(() => {
        return () => {
            if (routeLockTimerRef.current) clearTimeout(routeLockTimerRef.current);
        };
    }, []);

    useEffect(() => {
        if (knownPeer || !addPeer) return;
        const partial = {
            ...(username ? { username } : {}),
            ...(uid ? { uid } : {}),
            ...(chatPK ? { chatPK } : {}),
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
    }, [addPeer, chatPK, knownPeer, uid, username, walletPK]);

    const handleOpenHistory = useCallback(() => {
        const nextWalletPK = peer?.walletPK || walletPK;
        const nextChatPK = peer?.chatPK || chatPK;
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
    }, [chatPK, lockRoute, peer?.chatPK, peer?.walletPK, router, walletPK]);

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
                await submitReport({
                    uid: nextUid,
                    ...(note ? { note } : {}),
                });
                Alert.alert('Reported', 'We received the report.');
            } catch (error) {
                console.warn('report failed', error);
                Alert.alert('Report failed', error?.message || 'Could not submit this report.');
            }
        },
        [submitReport]
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

    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <View style={{ flex: 1, paddingTop: headerHeight + 24, paddingHorizontal: 24, alignItems: 'center' }}>
                <Avatar source={avatar} size={180} active={!!peer?.active} bot={!!peer?.bot} />
                <View style={{ marginTop: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                    <GlassIcon glassEffectStyle="regular" rounded={16} icon={History} onPress={handleOpenHistory} disabled={!(peer?.walletPK || walletPK) || !(peer?.chatPK || chatPK)} />
                    <GlassIcon glassEffectStyle="regular" rounded={16} icon={UserX} onPress={handleBlock} disabled={!(peer?.uid || uid)} />
                    <GlassIcon glassEffectStyle="regular" rounded={16} icon={Flag} onPress={handleReport} disabled={!(peer?.uid || uid)} />
                </View>
            </View>
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
