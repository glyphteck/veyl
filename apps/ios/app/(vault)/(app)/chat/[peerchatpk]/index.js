import { Alert, Animated as RNAnimated, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Reanimated, { Easing, LinearTransition, interpolate, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/providers/themeprovider';
import { useChat } from '@/providers/chatprovider';
import { useUser } from '@/providers/userprovider';
import { usePeer } from '@/providers/peerprovider';
import { useWallet } from '@/providers/walletprovider';
import FloatingHeader, { FloatingHeaderBackIcon, getFloatingHeaderHeight } from '@/components/floatingheader';
import ChatInput, { CommandBubbles, DraftBar } from '@/components/chat/chatinput';
import Messages from '@/components/chat/messages/list';
import { useReanimatedKeyboardAnimation } from '@/components/keyboardscroll';
import Icon from '@/components/icon';
import Avatar from '@/components/avatar';
import { prepareAssetForChatUpload } from '@/lib/chat/media';
import { mark } from '@/lib/diagnostics';
import { INVERTED_TOP_SCROLL_EDGE_EFFECTS, ScrollEdgeScreen } from '@/lib/navigation/scrolledge';
import { useRouteLock } from '@/lib/navigation/routelock';
import { useStableSafeAreaInsets } from '@/lib/safearea';
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
const COMPOSER_FOCUS_RELEASE_MS = 160;
const composerOverlayTiming = {
    duration: COMPOSER_OVERLAY_MS,
    easing: Easing.out(Easing.cubic),
};
const composerOverlayLayout = LinearTransition.duration(COMPOSER_OVERLAY_MS).easing(Easing.out(Easing.cubic));

function ComposerKeyboardStickyView({ children, enabled = true, holdOpen, offset: { closed = 0, opened = 0 } = {}, style, ...props }) {
    const { height, progress } = useReanimatedKeyboardAnimation();
    const noHold = useSharedValue(0);
    const hold = holdOpen || noHold;
    const lastOpenTranslate = useSharedValue(closed);

    // Multiline TextInput layout churn can briefly report a closed keyboard sample while focus is still active.
    useAnimatedReaction(
        () => {
            const offset = interpolate(progress.value, [0, 1], [closed, opened]);
            const translate = enabled ? height.value + offset : closed;
            const open = enabled && (progress.value > 0.01 || height.value < -1);
            return { open, translate };
        },
        ({ open, translate }) => {
            if (open || !hold.value) {
                lastOpenTranslate.value = translate;
            }
        },
        [closed, enabled, hold, opened]
    );

    const stickyStyle = useAnimatedStyle(() => {
        const offset = interpolate(progress.value, [0, 1], [closed, opened]);
        const translate = enabled ? height.value + offset : closed;
        const open = enabled && (progress.value > 0.01 || height.value < -1);
        if (!open && hold.value && lastOpenTranslate.value < closed - 1) {
            return { transform: [{ translateY: lastOpenTranslate.value }] };
        }
        return { transform: [{ translateY: translate }] };
    }, [closed, enabled, hold, opened]);

    const styles = useMemo(() => [style, stickyStyle], [stickyStyle, style]);

    return (
        <Reanimated.View style={styles} {...props}>
            {children}
        </Reanimated.View>
    );
}

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
    const insets = useStableSafeAreaInsets();
    const params = useLocalSearchParams();
    const router = useRouter();
    const { chats, getPeerChatId, selectPeerChat, sendMessage, sendAttachment, sendImage, updateMessage } = useChat();
    const { chatPK, chatBanned } = useUser();
    const { sendMoneyWithSpark } = useWallet();
    const { peerByChatPK, isBlockedChatPK, updatePeer } = usePeer() || {};
    const inputH = useRef(0);
    const { lockRoute } = useRouteLock();
    const inputApiRef = useRef(null);
    const inputBaseH = useRef(0);
    const overlayH = useRef(0);
    const activeOverlayRef = useRef(false);
    const focusReleaseTimerRef = useRef(null);
    const selectedRouteRef = useRef('');
    const [draft, setDraft] = useState(null);
    const [draftMounted, setDraftMounted] = useState(false);
    const [commandContext, setCommandContext] = useState({ kind: 'none', items: [] });
    const [inputBase, setInputBase] = useState(48);
    const [composerOverlayMounted, setComposerOverlayMounted] = useState(false);
    const initialHeaderHeight = useMemo(() => getFloatingHeaderHeight(insets.top), [insets.top]);
    const [headerHeight, setHeaderHeight] = useState(initialHeaderHeight);
    const stickyOffset = useMemo(() => ({ closed: 0, opened: insets.bottom - COMPOSER_KEYBOARD_GAP }), [insets.bottom]);
    const composerOverlayPadding = useSharedValue(0);
    const composerInputPadding = useSharedValue(0);
    const composerHoldOpen = useSharedValue(0);
    const composerExtraPadding = useDerivedValue(() => composerOverlayPadding.value + composerInputPadding.value);

    const ownChatPK = cleanChatPK(chatPK);
    const routeChatPK = cleanChatPK(firstRouteParam(params?.peerchatpk));
    const routeKey = `${ownChatPK || ''}:${routeChatPK || ''}`;
    const [routeChatState, setRouteChatState] = useState({ key: '', chatId: null });
    const routeKnownChatId = useMemo(() => {
        if (!ownChatPK || !routeChatPK) {
            return null;
        }
        const visibleChats = Array.isArray(chats) ? chats : [];
        return visibleChats.find((chat) => getChatPeerPK(chat, ownChatPK) === routeChatPK)?.id ?? getPeerChatId?.(routeChatPK) ?? null;
    }, [chats, getPeerChatId, ownChatPK, routeChatPK]);
    const rememberedRouteChatId = routeChatState.key === routeKey ? routeChatState.chatId : null;
    const chatId = routeKnownChatId || rememberedRouteChatId;
    const rememberRouteChatId = useCallback(
        (nextChatId) => {
            if (!nextChatId || !routeKey) {
                return;
            }
            setRouteChatState((prev) => (prev.key === routeKey && prev.chatId === nextChatId ? prev : { key: routeKey, chatId: nextChatId }));
        },
        [routeKey]
    );

    useEffect(() => {
        let active = true;
        if (!ownChatPK || !routeChatPK) {
            selectedRouteRef.current = '';
            setRouteChatState((prev) => (prev.key === '' && prev.chatId === null ? prev : { key: '', chatId: null }));
            return () => {
                active = false;
            };
        }
        if (routeKnownChatId) {
            setRouteChatState((prev) => (prev.key === routeKey && prev.chatId === routeKnownChatId ? prev : { key: routeKey, chatId: routeKnownChatId }));
        }
        const selectKey = `${routeKey}:${routeKnownChatId || ''}`;
        if (selectedRouteRef.current === selectKey) {
            return () => {
                active = false;
            };
        }
        selectedRouteRef.current = selectKey;
        mark('chat.select', { chatId: routeKnownChatId || '', peerChatPK: routeChatPK });
        Promise.resolve(selectPeerChat?.(routeChatPK))
            .then((nextChatId) => {
                if (active) {
                    const selectedChatId = nextChatId || routeKnownChatId || null;
                    setRouteChatState((prev) => (prev.key === routeKey && prev.chatId === selectedChatId ? prev : { key: routeKey, chatId: selectedChatId }));
                }
            })
            .catch(() => {
                if (active) {
                    const selectedChatId = routeKnownChatId || null;
                    setRouteChatState((prev) => (prev.key === routeKey && prev.chatId === selectedChatId ? prev : { key: routeKey, chatId: selectedChatId }));
                }
            });
        return () => {
            active = false;
        };
    }, [ownChatPK, routeChatPK, routeKey, routeKnownChatId, selectPeerChat]);
    const currentChat = useMemo(() => (chatId && Array.isArray(chats) ? (chats.find((chat) => chat?.id === chatId) ?? null) : null), [chatId, chats]);

    const peerChatPK = useMemo(() => getChatPeerPK(currentChat, chatPK) ?? routeChatPK, [chatPK, currentChat, routeChatPK]);
    const routeBlocked = !!peerChatPK && !!isBlockedChatPK?.(peerChatPK);
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
        setHeaderHeight((current) => (current >= initialHeaderHeight ? current : initialHeaderHeight));
    }, [initialHeaderHeight]);

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
        if (!routeBlocked) {
            return;
        }
        router.dismissTo('/chat');
    }, [routeBlocked, router]);

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
            if (result?.chatId) rememberRouteChatId(result.chatId);
        },
        [peerChatPK, rememberRouteChatId, sendMessage]
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
                    if (result?.chatId) rememberRouteChatId(result.chatId);
                    mark('chat.image.sendVideo.done', {});
                    return;
                }
                mark('chat.image.send.start', { size: prepared?.size || prepared?.data?.byteLength || 0 });
                const result = await sendImage?.(peerChatPK, prepared);
                if (result?.chatId) rememberRouteChatId(result.chatId);
                mark('chat.image.send.done', {});
            } catch (error) {
                mark('chat.image.send.error', { message: error?.message || String(error), code: error?.code || '', stage: error?.stage || '' });
                console.warn('chat image send failed', error);
                showUploadError('Upload failed', error, 'Could not send this media. Please try again.');
            }
        },
        [peerChatPK, rememberRouteChatId, sendAttachment, sendImage]
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
                if (result?.chatId) rememberRouteChatId(result.chatId);
            } catch (error) {
                console.warn('chat attachment send failed', error);
                showUploadError('Upload failed', error, 'Could not send this attachment. Please try again.');
            }
        },
        [peerChatPK, rememberRouteChatId, sendAttachment]
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

    const applyInputHeight = useCallback(
        (height) => {
            const h = Math.round(Number(height) || 0);
            if (!h) return;
            if (h === inputH.current) return;
            inputH.current = h;
            if (!inputBaseH.current || h < inputBaseH.current) {
                inputBaseH.current = h;
                setInputBase(h);
            }
            composerInputPadding.value = Math.max(0, h - inputBaseH.current);
        },
        [composerInputPadding]
    );
    const onInputLayout = useCallback(
        (e) => {
            applyInputHeight(e?.nativeEvent?.layout?.height);
        },
        [applyInputHeight]
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
                    if (result?.chatId) rememberRouteChatId(result.chatId);
                } catch (error) {
                    Alert.alert('Request failed', error?.message || 'Failed to send request.');
                }
            }
        },
        [chatBanned, peerChatPK, peerProfile?.walletPK, rememberRouteChatId, sendMessage, sendMoneyWithSpark]
    );

    const handleCommandBubblePress = useCallback((prefix) => {
        inputApiRef.current?.setText?.(prefix);
    }, []);
    const handleInputFocusChange = useCallback(
        (focused) => {
            if (focusReleaseTimerRef.current) {
                clearTimeout(focusReleaseTimerRef.current);
                focusReleaseTimerRef.current = null;
            }
            if (focused) {
                composerHoldOpen.value = 1;
                return;
            }
            focusReleaseTimerRef.current = setTimeout(() => {
                focusReleaseTimerRef.current = null;
                composerHoldOpen.value = 0;
            }, COMPOSER_FOCUS_RELEASE_MS);
        },
        [composerHoldOpen]
    );

    useEffect(
        () => () => {
            if (focusReleaseTimerRef.current) {
                clearTimeout(focusReleaseTimerRef.current);
                focusReleaseTimerRef.current = null;
            }
        },
        []
    );

    useEffect(() => {
        if (draft) {
            setDraftMounted(true);
        }
    }, [draft]);

    const hasComposerOverlay = !!draft || draftMounted || !!commandContext.items?.length;
    const handleHeaderLayout = useCallback((event) => {
        const height = Math.round(Number(event?.nativeEvent?.layout?.height) || 0);
        if (height > 0) {
            setHeaderHeight((current) => (current === height ? current : height));
        }
    }, []);

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

    if (chatBanned || routeBlocked) {
        return null;
    }

    const draftKey = draft ? `${draft.mode}:${getMessageKey(draft.msg) || draft.msg?.ts?.toMillis?.() || ''}` : '';

    return (
        <View style={{ flex: 1 }}>
            <View style={{ flex: 1, overflow: 'hidden' }}>
                <FloatingHeader onLayout={handleHeaderLayout}>
                    <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                        <FloatingHeaderBackIcon onPress={() => router.dismissTo('/chat')} />
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
                </FloatingHeader>
                <ScrollEdgeScreen scrollEdgeEffects={INVERTED_TOP_SCROLL_EDGE_EFFECTS}>
                    <Messages
                        chatId={chatId}
                        chatTitle={chatTitle}
                        onRequestHold={handleOpenHistory}
                        onReply={handleReply}
                        onEdit={handleEdit}
                        draftKey={draftKey}
                        headerHeight={headerHeight}
                        inputH={inputBase}
                        extraContentPadding={composerExtraPadding}
                        peerAvatarSource={peerAvatarSource}
                        peerBot={!!peerProfile?.bot}
                        peerChatPK={peerChatPK}
                        peerUid={peerProfile?.uid}
                        peerWalletPK={peerProfile?.walletPK}
                    >
                        {ENABLE_CHAT_COMPOSER ? (
                            <ComposerKeyboardStickyView
                                holdOpen={composerHoldOpen}
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
                                <View style={{ paddingHorizontal: 14 }}>
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
                                            onFocusChange={handleInputFocusChange}
                                            onHeightChange={applyInputHeight}
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
                            </ComposerKeyboardStickyView>
                        ) : null}
                    </Messages>
                </ScrollEdgeScreen>
            </View>
        </View>
    );
}
