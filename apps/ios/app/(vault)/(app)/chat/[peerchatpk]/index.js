import { Alert, Animated as RNAnimated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Reanimated, { Easing, LinearTransition, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/providers/themeprovider';
import { useChat } from '@/providers/chatprovider';
import { useUser } from '@/providers/userprovider';
import { usePeer } from '@/providers/peerprovider';
import { useWallet } from '@/providers/walletprovider';
import GlassHeader from '@/components/glass/glassheader';
import ChatInput, { CommandBubbles, DraftBar } from '@/components/chat/chatinput';
import Messages from '@/components/chat/messages/list';
import { KeyboardStickyView } from '@/components/keyboardscroll';
import Icon from '@/components/icon';
import Avatar from '@/components/avatar';
import { prepareAssetForChatUpload } from '@/lib/chat/media';
import { mark } from '@/lib/diagnostics';
import { useRouteLock } from '@/lib/navigation/routelock';
import { formatUserDisplay } from '@veyl/shared/profile';
import { getChatPeerPK } from '@veyl/shared/chat/ids';
import { chatUploadErrorMessage } from '@veyl/shared/chat/attachments';
import { getMessageKey } from '@veyl/shared/chat/state';
import { canReplyToMsg, isPeerMsg, makeReq, makeTxt, setReply, setTxt } from '@veyl/shared/chat/messages';
import { useTap } from '@/lib/tap';
import { getCommandContext, parseCommandAmountSats } from '@veyl/shared/commands';
import { firstRouteParam } from '@veyl/shared/navigation/params';
import { lowerText } from '@veyl/shared/utils/text';

const ENABLE_CHAT_COMPOSER = true;
const ENABLE_CHAT_INPUT = true;
const COMPOSER_KEYBOARD_GAP = 8;
const COMPOSER_OVERLAY_GAP = 8;
const COMPOSER_OVERLAY_MS = 80;
const COMPOSER_OVERLAY_EXIT_HOLD_MS = COMPOSER_OVERLAY_MS;
const composerOverlayTiming = {
    duration: COMPOSER_OVERLAY_MS,
    easing: Easing.out(Easing.cubic),
};
const composerOverlayLayout = LinearTransition.duration(COMPOSER_OVERLAY_MS).easing(Easing.out(Easing.cubic));

function uploadErrorMessage(error, fallback) {
    return chatUploadErrorMessage(error, {
        fallback,
        videoUnavailable: () => 'This video could not be read. Try a shorter video or export it again.',
    });
}

function showUploadError(title, error, fallback) {
    Alert.alert(title, uploadErrorMessage(error, fallback));
}

function cleanChatPK(value) {
    const chatPK = lowerText(value);
    return /^[0-9a-f]{64}$/.test(chatPK) ? chatPK : null;
}

export default function PeerChatRoute() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams();
    const router = useRouter();
    const { chats, selectChat, resolvePeerChatId, sendMessage, sendAttachment, sendImage, updateMessage } = useChat();
    const { chatPK, chatBanned } = useUser();
    const { sendMoneyWithSpark } = useWallet();
    const { peerByChatPK, updatePeer } = usePeer() || {};
    const backTap = useTap({ onPress: () => router.dismissTo('/chat') });
    const inputH = useRef(0);
    const { lockRoute } = useRouteLock();
    const inputApiRef = useRef(null);
    const inputBaseH = useRef(0);
    const overlayH = useRef(0);
    const activeOverlayRef = useRef(false);
    const [draft, setDraft] = useState(null);
    const [draftMounted, setDraftMounted] = useState(false);
    const [commandContext, setCommandContext] = useState({ kind: 'none', items: [] });
    const [inputBase, setInputBase] = useState(48);
    const [composerOverlayMounted, setComposerOverlayMounted] = useState(false);
    const stickyOffset = useMemo(() => ({ closed: 0, opened: insets.bottom - COMPOSER_KEYBOARD_GAP }), [insets.bottom]);
    const composerOverlayPadding = useSharedValue(0);
    const composerInputPadding = useSharedValue(0);
    const composerExtraPadding = useDerivedValue(() => composerOverlayPadding.value + composerInputPadding.value);

    const ownChatPK = cleanChatPK(chatPK);
    const routeChatPK = cleanChatPK(firstRouteParam(params?.peerchatpk));
    const [chatId, setChatId] = useState(null);

    useEffect(() => {
        let active = true;
        setChatId(null);
        if (!ownChatPK || !routeChatPK) {
            return () => {
                active = false;
            };
        }
        resolvePeerChatId?.(routeChatPK)
            .then((nextChatId) => {
                if (active) setChatId(nextChatId || null);
            })
            .catch(() => {
                if (active) setChatId(null);
            });
        return () => {
            active = false;
        };
    }, [ownChatPK, resolvePeerChatId, routeChatPK]);
    const currentChat = useMemo(() => (chatId && Array.isArray(chats) ? (chats.find((chat) => chat?.id === chatId) ?? null) : null), [chatId, chats]);

    const peerChatPK = useMemo(() => getChatPeerPK(currentChat, chatPK) ?? routeChatPK, [chatPK, currentChat, routeChatPK]);
    const peerProfile = useMemo(() => (peerChatPK ? (peerByChatPK?.get(peerChatPK) ?? null) : null), [peerByChatPK, peerChatPK]);
    const chatTitle = useMemo(() => {
        if (!peerChatPK) return 'chat';
        return peerProfile?.username || formatUserDisplay({ chatPK: peerChatPK });
    }, [peerChatPK, peerProfile?.username]);
    const peerAvatarSource = useMemo(() => (peerProfile?.avatar ? { uri: peerProfile.avatar } : null), [peerProfile?.avatar]);
    const settingsPeer = useMemo(() => {
        if (!peerChatPK && !peerProfile) return null;
        return {
            username: peerProfile?.username || null,
            uid: peerProfile?.uid || null,
            chatPK: peerProfile?.chatPK || peerChatPK || null,
            walletPK: peerProfile?.walletPK || null,
            avatar: peerProfile?.avatar || null,
            active: !!peerProfile?.active,
            bot: !!peerProfile?.bot,
        };
    }, [peerChatPK, peerProfile]);
    const hasChat = !!currentChat;
    const hasPeerProfile = !!peerProfile;

    useEffect(() => {
        if (!chatId) {
            return undefined;
        }
        let timer = null;
        const frame = requestAnimationFrame(() => {
            timer = setTimeout(() => {
                mark('chat.select', { chatId });
                selectChat?.(chatId);
            }, 0);
        });
        return () => {
            cancelAnimationFrame(frame);
            if (timer) clearTimeout(timer);
        };
    }, [chatId, selectChat]);

    useEffect(() => {
        mark('chat.route', {
            chatId: chatId || '',
            peerChatPK: peerChatPK || '',
            hasChat,
            hasPeerProfile,
            title: chatTitle,
        });
    }, [chatId, chatTitle, hasChat, hasPeerProfile, peerChatPK]);

    useEffect(() => {
        return () => {
            mark('chat.route.unmount', { chatId: chatId || '' });
        };
    }, [chatId]);

    useEffect(() => {
        if (!peerProfile?.uid) {
            return undefined;
        }
        const timer = setTimeout(() => {
            updatePeer?.(peerProfile.uid);
        }, 450);
        return () => clearTimeout(timer);
    }, [peerProfile?.uid, updatePeer]);

    useEffect(() => {
        if (!chatBanned) {
            return;
        }
        router.replace('/wallet');
    }, [chatBanned, router]);

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
        disabled: !settingsPeer,
        onPress: () => {
            if (!settingsPeer) return;
            if (!lockRoute()) return;
            router.push({
                pathname: '/chat/[peerchatpk]/settings',
                params: {
                    peerchatpk: peerChatPK,
                    chatId: chatId ?? '',
                    peer: JSON.stringify(settingsPeer),
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
            const result = await sendMessage?.(peerChatPK, replyId ? setReply(base, replyId) : base);
            if (result?.chatId) setChatId(result.chatId);
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
                showUploadError('Upload failed', error, 'Could not prepare this media. Please try another file.');
                return;
            }

            try {
                if (String(prepared?.mimeType || '').startsWith('video/')) {
                    mark('chat.image.sendVideo.start', { size: prepared?.size || prepared?.data?.byteLength || 0 });
                    const result = await sendAttachment?.(peerChatPK, prepared);
                    if (result?.chatId) setChatId(result.chatId);
                    mark('chat.image.sendVideo.done', {});
                    return;
                }
                mark('chat.image.send.start', { size: prepared?.size || prepared?.data?.byteLength || 0 });
                const result = await sendImage?.(peerChatPK, prepared);
                if (result?.chatId) setChatId(result.chatId);
                mark('chat.image.send.done', {});
            } catch (error) {
                mark('chat.image.send.error', { message: error?.message || String(error), code: error?.code || '', stage: error?.stage || '' });
                console.warn('chat image send failed', error);
                showUploadError('Upload failed', error, 'Could not send this media. Please try again.');
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
                showUploadError('Upload failed', error, 'Could not prepare this attachment. Please try another file.');
                return;
            }

            try {
                const result = await sendAttachment?.(peerChatPK, prepared);
                if (result?.chatId) setChatId(result.chatId);
            } catch (error) {
                console.warn('chat attachment send failed', error);
                showUploadError('Upload failed', error, 'Could not send this attachment. Please try again.');
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
            if (!inputBaseH.current) {
                inputBaseH.current = h;
                setInputBase(h);
                composerInputPadding.value = 0;
                return;
            }
            composerInputPadding.value = withTiming(Math.max(0, h - inputBaseH.current), composerOverlayTiming);
        },
        [composerInputPadding]
    );
    const onOverlayLayout = useCallback(
        (e) => {
            const h = Math.round(e?.nativeEvent?.layout?.height ?? 0);
            if (h === overlayH.current) return;
            overlayH.current = h;
            if (activeOverlayRef.current) {
                composerOverlayPadding.value = withTiming(h, composerOverlayTiming);
            }
        },
        [composerOverlayPadding]
    );

    const handleReply = useCallback((msg) => {
        if (!canReplyToMsg(msg)) {
            return;
        }
        setDraft({ mode: 'reply', msg, fromPeer: isPeerMsg(msg, chatPK) });
    }, [chatPK]);

    const handleEdit = useCallback((msg) => {
        setDraft({ mode: 'edit', msg });
    }, []);

    const handleClearDraft = useCallback(() => {
        setDraft(null);
    }, []);

    const handleDraftHidden = useCallback(() => {
        setDraftMounted(false);
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
                    Alert.alert('Wallet unavailable', 'This person cannot receive money yet.');
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
                    Alert.alert('Chat unavailable', 'This person cannot receive requests yet.');
                    return;
                }
                try {
                    const result = await sendMessage?.(peerChatPK, makeReq(amountSats));
                    if (result?.chatId) setChatId(result.chatId);
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

    useEffect(() => {
        if (draft) {
            setDraftMounted(true);
        }
    }, [draft]);

    const hasComposerOverlay = !!draft || draftMounted || !!commandContext.items?.length;

    useEffect(() => {
        activeOverlayRef.current = hasComposerOverlay;
        if (hasComposerOverlay) {
            setComposerOverlayMounted(true);
            if (overlayH.current) {
                composerOverlayPadding.value = withTiming(overlayH.current, composerOverlayTiming);
            }
            return undefined;
        }

        composerOverlayPadding.value = withTiming(0, composerOverlayTiming);
        const timer = setTimeout(() => setComposerOverlayMounted(false), COMPOSER_OVERLAY_EXIT_HOLD_MS);
        return () => clearTimeout(timer);
    }, [composerOverlayPadding, hasComposerOverlay]);

    if (chatBanned) {
        return null;
    }

    const draftKey = draft ? `${draft.mode}:${getMessageKey(draft.msg) || draft.msg?.ts?.toMillis?.() || ''}` : '';

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
            <Messages
                chatId={chatId}
                chatTitle={chatTitle}
                onRequestHold={handleOpenHistory}
                onReply={handleReply}
                onEdit={handleEdit}
                draftKey={draftKey}
                inputH={inputBase}
                extraContentPadding={composerExtraPadding}
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
                        <View style={{ paddingHorizontal: 16 }}>
                            <Reanimated.View
                                collapsable={false}
                                layout={composerOverlayLayout}
                                onLayout={onOverlayLayout}
                                style={{ gap: COMPOSER_OVERLAY_GAP, paddingBottom: composerOverlayMounted ? COMPOSER_OVERLAY_GAP : 0 }}
                            >
                                <CommandBubbles items={commandContext.items} onSelect={handleCommandBubblePress} interactive={commandContext.kind === 'pick'} />
                                <DraftBar draft={draft} peerDisplayName={chatTitle} onClear={handleClearDraft} onHidden={handleDraftHidden} />
                            </Reanimated.View>
                            {ENABLE_CHAT_INPUT ? (
                                <ChatInput
                                    onLayout={onInputLayout}
                                    onSend={handleSend}
                                    onEditMessage={handleEditMessage}
                                    onSendImage={handleSendImage}
                                    onSendAttachment={handleSendAttachment}
                                    onSendMoney={peerProfile?.walletPK ? () => handleOpenTransfer('send') : undefined}
                                    onCommand={handleCommand}
                                    onCommandChange={handleCommandChange}
                                    inputApiRef={inputApiRef}
                                    draft={draft}
                                    onClearDraft={handleClearDraft}
                                    draftKey={draftKey}
                                />
                            ) : (
                                <View onLayout={onInputLayout} style={{ height: inputBase, borderRadius: 24, backgroundColor: theme.background }} />
                            )}
                        </View>
                    </KeyboardStickyView>
                ) : null}
            </Messages>
            </View>
        </View>
    );
}
