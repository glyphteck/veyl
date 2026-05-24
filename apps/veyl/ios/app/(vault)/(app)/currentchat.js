import { Alert, Animated as RNAnimated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image as ExpoImage } from 'expo-image';
import { useTheme } from '@/providers/themeprovider';
import { useChat } from '@/providers/chatprovider';
import { useUser } from '@/providers/userprovider';
import { usePeer } from '@/providers/peerprovider';
import { useWallet } from '@/providers/walletprovider';
import GlassHeader from '@/components/glass/glassheader';
import ChatInput, { CommandBubbles, DraftBar } from '@/components/chat/chatinput';
import MessageList from '@/components/chat/messagelist';
import { KeyboardStickyView } from '@/components/keyboardscroll';
import Icon from '@/components/icon';
import Avatar from '@/components/avatar';
import { prepareAssetForChatUpload } from '@/lib/chatmedia';
import { mark } from '@/lib/diagnostics';
import { formatUserDisplay } from '@glyphteck/shared/utils';
import { getPeerChatPKFromChatId } from '@glyphteck/shared/chat/utils';
import { canReplyToMsg, makeReq, makeTxt, setReply, setTxt } from '@glyphteck/shared/chat/messages';
import { useTap } from '@/lib/tap';
import { getCommandContext, parseCommandAmountSats } from '@glyphteck/shared/commands';

const ENABLE_CHAT_COMPOSER = true;
const ENABLE_CHAT_INPUT = true;
const COMPOSER_KEYBOARD_GAP = 8;

export default function CurrentChatRoute() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams();
    const router = useRouter();
    const { chats, selectChat, sendMessage, sendAttachment, sendImage, updateMessage } = useChat();
    const { chatPK, chatBanned } = useUser();
    const { sendMoneyWithSpark } = useWallet();
    const { peers, updatePeer } = usePeer() || {};
    const backTap = useTap({ onPress: router.back });
    const inputH = useRef(0);
    const routeLockRef = useRef(false);
    const routeLockTimerRef = useRef(null);
    const inputApiRef = useRef(null);
    const [draft, setDraft] = useState(null);
    const [commandContext, setCommandContext] = useState({ kind: 'none', items: [] });
    const [inputBase, setInputBase] = useState(48);
    const stickyOffset = useMemo(() => ({ closed: 0, opened: insets.bottom - COMPOSER_KEYBOARD_GAP }), [insets.bottom]);

    const chatId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : null;
    const currentChat = useMemo(() => (chatId && Array.isArray(chats) ? (chats.find((chat) => chat?.id === chatId) ?? null) : null), [chatId, chats]);

    const peerChatPK = useMemo(
        () => currentChat?.participants?.find?.((participant) => participant && participant !== chatPK) ?? getPeerChatPKFromChatId(chatId, chatPK),
        [currentChat?.participants, chatId, chatPK]
    );
    const peerProfile = useMemo(() => (peerChatPK && Array.isArray(peers) ? peers.find((p) => p?.chatPK === peerChatPK) : null), [peerChatPK, peers]);
    const chatTitle = useMemo(() => {
        if (!peerChatPK) return 'chat';
        return peerProfile?.username || formatUserDisplay({ chatPK: peerChatPK });
    }, [peerChatPK, peerProfile?.username]);
    const peerAvatarSource = useMemo(() => (peerProfile?.avatar ? { uri: peerProfile.avatar } : null), [peerProfile?.avatar]);
    const peerRoute = peerProfile?.username || '';
    const hasCurrentChat = !!currentChat;
    const hasPeerProfile = !!peerProfile;

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
        if (!chatId) {
            return;
        }
        mark('chat.select', { chatId });
        selectChat?.(chatId);
    }, [chatId, selectChat]);

    useEffect(() => {
        mark('chat.route', {
            chatId: chatId || '',
            peerChatPK: peerChatPK || '',
            hasCurrentChat,
            hasPeerProfile,
            title: chatTitle,
        });
    }, [chatId, chatTitle, hasCurrentChat, hasPeerProfile, peerChatPK]);

    useEffect(() => {
        return () => {
            mark('chat.route.unmount', { chatId: chatId || '' });
        };
    }, [chatId]);

    useEffect(() => {
        if (!peerProfile?.uid) {
            return;
        }
        updatePeer?.(peerProfile.uid, { refreshAvatar: true });
    }, [peerProfile?.uid, updatePeer]);

    useEffect(() => {
        if (!peerProfile?.avatar) {
            return;
        }
        void ExpoImage.prefetch(peerProfile.avatar, 'memory-disk');
    }, [peerProfile?.avatar]);

    useEffect(() => {
        if (!chatBanned) {
            return;
        }
        router.replace('/wallet');
    }, [chatBanned, router]);

    useEffect(() => {
        return () => {
            if (routeLockTimerRef.current) clearTimeout(routeLockTimerRef.current);
        };
    }, []);

    useEffect(() => {
        setDraft(null);
        setCommandContext({ kind: 'none', items: [] });
    }, [chatId]);

    const handleOpenHistory = useCallback(() => {
        if (!peerProfile?.walletPK || !peerChatPK) {
            return;
        }
        if (!lockRoute()) return;
        router.push({
            pathname: '/history',
            params: {
                walletPK: peerProfile.walletPK,
                chatPK: peerChatPK,
            },
        });
    }, [lockRoute, peerChatPK, peerProfile?.walletPK, router]);

    const avatarTap = useTap({
        disabled: !peerRoute,
        onPress: () => {
            if (!peerRoute) return;
            if (!lockRoute()) return;
            router.push({
                pathname: '/[username]',
                params: {
                    username: peerRoute,
                    chatId: chatId ?? '',
                    chatPK: peerChatPK ?? '',
                    uid: peerProfile?.uid ?? '',
                    walletPK: peerProfile?.walletPK ?? '',
                },
            });
        },
    });

    const handleSend = useCallback(
        async (text, draftState) => {
            if (!peerChatPK) return;
            const base = makeTxt(text);
            const canReply = draftState?.mode === 'reply' && canReplyToMsg(draftState?.msg);
            const replyId = String(canReply ? (typeof draftState?.msg?.id === 'string' && !draftState.msg.id.startsWith('local:') ? draftState.msg.id : draftState?.msg?.cid) || '' : '').trim();
            await sendMessage?.(peerChatPK, replyId ? setReply(base, replyId) : base);
        },
        [peerChatPK, sendMessage]
    );

    const handleEditMessage = useCallback(
        async (msg, text) => {
            if (!chatId || !peerChatPK || !msg?.id || msg?.t !== 'txt') {
                return;
            }
            const next = setTxt(msg, text);
            await updateMessage?.(chatId, msg.id, next, peerChatPK);
        },
        [chatId, peerChatPK, updateMessage]
    );

    const handleSendImage = useCallback(
        async (asset) => {
            if (!peerChatPK || !asset?.uri) return;
            mark('chat.image.prepare.start', { uri: asset.uri, mimeType: asset?.mimeType || '', width: asset?.width || 0, height: asset?.height || 0, fileSize: asset?.fileSize || asset?.size || 0 });

            let prepared;
            try {
                prepared = await prepareAssetForChatUpload(asset);
                mark('chat.image.prepare.done', { mimeType: prepared?.mimeType || '', size: prepared?.size || prepared?.data?.byteLength || 0, width: prepared?.width || 0, height: prepared?.height || 0, name: prepared?.name || '' });
            } catch (error) {
                mark('chat.image.prepare.error', { message: error?.message || String(error), code: error?.code || '' });
                console.warn('chat image prepare failed', error);
                return;
            }

            try {
                if (String(prepared?.mimeType || '').startsWith('video/')) {
                    mark('chat.image.sendVideo.start', { size: prepared?.size || prepared?.data?.byteLength || 0 });
                    await sendAttachment?.(peerChatPK, prepared);
                    mark('chat.image.sendVideo.done', {});
                    return;
                }
                mark('chat.image.send.start', { size: prepared?.size || prepared?.data?.byteLength || 0 });
                await sendImage?.(peerChatPK, prepared);
                mark('chat.image.send.done', {});
            } catch (error) {
                mark('chat.image.send.error', { message: error?.message || String(error), code: error?.code || '', stage: error?.stage || '' });
                console.warn('chat image send failed', error);
            }
        },
        [peerChatPK, sendAttachment, sendImage]
    );

    const handleSendAttachment = useCallback(
        async (asset) => {
            if (!peerChatPK || !asset?.uri) return;

            let prepared;
            try {
                prepared = await prepareAssetForChatUpload(asset);
            } catch (error) {
                console.warn('chat attachment prepare failed', error);
                return;
            }

            try {
                await sendAttachment?.(peerChatPK, prepared);
            } catch (error) {
                console.warn('chat attachment send failed', error);
            }
        },
        [peerChatPK, sendAttachment]
    );

    const handleOpenTransfer = useCallback(
        (mode = 'send', amount = '') => {
            if (!peerProfile?.uid && !peerProfile?.walletPK) {
                return;
            }
            if (!lockRoute()) return;
            router.push({
                pathname: '/transfer',
                params: {
                    uid: peerProfile?.uid ?? '',
                    walletPK: peerProfile?.walletPK ?? '',
                    ...(amount ? { amount } : {}),
                    ...(mode === 'request' ? { mode: 'request' } : {}),
                },
            });
        },
        [lockRoute, peerProfile?.uid, peerProfile?.walletPK, router]
    );

    const onInputLayout = useCallback(
        (e) => {
            const h = Math.round(e?.nativeEvent?.layout?.height ?? 0);
            if (!h) return;
            if (h === inputH.current) return;
            inputH.current = h;
            setInputBase(h);
        },
        []
    );

    const handleReply = useCallback((msg) => {
        if (!canReplyToMsg(msg)) {
            return;
        }
        setDraft({ mode: 'reply', msg });
    }, []);

    const handleEdit = useCallback((msg) => {
        setDraft({ mode: 'edit', msg });
    }, []);

    const handleClearDraft = useCallback(() => {
        setDraft(null);
    }, []);

    const handleCommandChange = useCallback(
        (value) => {
            if (draft?.mode === 'edit') {
                setCommandContext({ kind: 'none', items: [] });
                return;
            }
            if (!value?.startsWith('/')) {
                setCommandContext({ kind: 'none', items: [] });
                return;
            }
            setCommandContext(getCommandContext(value, { mode: 'chat' }));
        },
        [draft?.mode]
    );

    const handleCommand = useCallback(
        async (command) => {
            if (!command?.complete) {
                return;
            }
            const amountSats = parseCommandAmountSats(command.args.amount);
            if (!amountSats) {
                Alert.alert('Invalid amount', 'Enter a whole number of sats.');
                return;
            }
            if (command.name === 'send') {
                if (!peerProfile?.walletPK) {
                    Alert.alert('Missing address', 'This person has no wallet key yet.');
                    return;
                }
                try {
                    await sendMoneyWithSpark(peerProfile.walletPK, amountSats);
                } catch (error) {
                    Alert.alert('Send failed', error?.message || 'Failed to send money.');
                }
                return;
            }
            if (command.name === 'request') {
                if (chatBanned) {
                    Alert.alert('Chat unavailable', 'You cannot send requests right now.');
                    return;
                }
                if (!peerChatPK) {
                    Alert.alert('Missing chat key', 'This person has no chat key yet.');
                    return;
                }
                try {
                    await sendMessage?.(peerChatPK, makeReq(amountSats));
                } catch (error) {
                    Alert.alert('Request failed', error?.message || 'Failed to send request.');
                }
            }
        },
        [chatBanned, peerChatPK, peerProfile?.walletPK, sendMessage, sendMoneyWithSpark]
    );

    const handleCommandBubblePress = useCallback((prefix) => {
        inputApiRef.current?.setText?.(prefix);
    }, []);

    if (chatBanned) {
        return null;
    }

    const draftKey = draft ? `${draft.mode}:${draft.msg?.cid || draft.msg?.id || draft.msg?.ts?.toMillis?.() || ''}` : '';

    return (
        <View style={{ flex: 1 }}>
            <View style={{ flex: 1, overflow: 'hidden' }}>
            <GlassHeader
                style={{ zIndex: 2 }}
                contentStyle={{
                    flexDirection: 'row',
                    alignItems: 'center',
                }}
            >
                <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                    <Pressable {...backTap.props} hitSlop={10}>
                        <RNAnimated.View style={{ transform: [{ scale: backTap.scale }] }}>
                            <Icon icon={ChevronLeft} color={theme.foreground} size={32} />
                        </RNAnimated.View>
                    </Pressable>
                </View>
                <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text
                        numberOfLines={1}
                        style={{
                            textAlign: 'center',
                            fontSize: 24,
                            fontWeight: '900',
                            color: theme.foreground,
                            minWidth: 0,
                        }}
                    >
                        {chatTitle}
                    </Text>
                </View>
                <View style={{ width: 56, alignItems: 'flex-end', justifyContent: 'center' }}>
                    <Pressable {...avatarTap.props} hitSlop={10}>
                        <RNAnimated.View style={{ transform: [{ scale: avatarTap.scale }] }}>
                            <Avatar source={peerAvatarSource} size={48} pointerEvents="none" active={!!peerProfile?.active} bot={!!peerProfile?.bot} />
                        </RNAnimated.View>
                    </Pressable>
                </View>
            </GlassHeader>
            <MessageList
                chatId={chatId}
                chatTitle={chatTitle}
                onRequestHold={handleOpenHistory}
                onReply={handleReply}
                onEdit={handleEdit}
                draftKey={draftKey}
                inputH={inputBase}
                peerAvatarSource={peerAvatarSource}
                peerBot={!!peerProfile?.bot}
                peerChatPK={peerChatPK}
                peerUid={peerProfile?.uid}
                peerWalletPK={peerProfile?.walletPK}
            >
                {ENABLE_CHAT_COMPOSER ? (
                    <KeyboardStickyView
                        offset={stickyOffset}
                        style={{
                            position: 'absolute',
                            bottom: insets.bottom,
                            left: 0,
                            right: 0,
                            zIndex: 2,
                        }}
                        pointerEvents="box-none"
                    >
                        <View onLayout={onInputLayout} style={{ paddingHorizontal: 16 }}>
                            <CommandBubbles items={commandContext.items} onSelect={handleCommandBubblePress} interactive={commandContext.kind === 'pick'} />
                            <DraftBar draft={draft} onClear={handleClearDraft} />
                            {ENABLE_CHAT_INPUT ? (
                                <ChatInput
                                    onSend={handleSend}
                                    onEditMessage={handleEditMessage}
                                    onSendImage={handleSendImage}
                                    onSendAttachment={handleSendAttachment}
                                    onSendMoney={peerProfile?.walletPK ? () => handleOpenTransfer('send') : undefined}
                                    onCommand={handleCommand}
                                    onCommandChange={handleCommandChange}
                                    draft={draft}
                                    onClearDraft={handleClearDraft}
                                    draftKey={draftKey}
                                />
                            ) : (
                                <View style={{ height: inputBase, borderRadius: 24, backgroundColor: theme.background }} />
                            )}
                        </View>
                    </KeyboardStickyView>
                ) : null}
            </MessageList>
            </View>
        </View>
    );
}
