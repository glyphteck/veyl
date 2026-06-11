import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Pressable, Text, TextInput } from 'react-native';
import Reanimated, { Easing, LinearTransition, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ArrowRightCircle, AudioLines, File, Film, HandCoins, Image as ImageIcon, Paperclip, Reply, SquarePen, X } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/providers/themeprovider';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTxData } from '@/providers/txdataprovider';
import { useUser } from '@/providers/userprovider';
import { useTap } from '@/lib/tap';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import { mark } from '@/lib/diagnostics';
import { parseCommand } from '@veyl/shared/commands';
import { getRequestContext } from '@veyl/shared/chat/messages';

const INACTIVE_OPACITY = 0.32;
const COMPOSER_POP_MS = 80;
const COMPOSER_POP_EXIT_HOLD_MS = COMPOSER_POP_MS;
const COMPOSER_POP_FROM = 0.001;

const composerLayout = LinearTransition.duration(COMPOSER_POP_MS).easing(Easing.out(Easing.cubic));
const composerPopInTiming = {
    duration: COMPOSER_POP_MS,
    easing: Easing.out(Easing.cubic),
};
const composerPopOutTiming = {
    duration: COMPOSER_POP_MS,
    easing: Easing.in(Easing.cubic),
};

const SendButton = memo(function SendButton({ canSend, onPress }) {
    const { theme } = useTheme();
    const sendFeedback = useTap({
        onPress,
        disabled: !canSend,
        hapticIn: 'light',
    });

    return (
        <Pressable {...sendFeedback.props} style={{ alignSelf: 'flex-end', marginBottom: -2 }} hitSlop={12} disabled={!canSend}>
            <Animated.View style={{ transform: [{ scale: sendFeedback.scale }], opacity: canSend ? 1 : INACTIVE_OPACITY }}>
                <Icon icon={ArrowRightCircle} color={theme.foreground} size={28} />
            </Animated.View>
        </Pressable>
    );
});

const AttachButton = memo(function AttachButton({ onPress, disabled = false }) {
    const { theme } = useTheme();
    const tap = useTap({
        onPress,
        disabled,
        hapticIn: 'selection',
    });

    return (
        <Pressable {...tap.props} style={{ alignSelf: 'flex-end', marginBottom: -2 }} hitSlop={12} disabled={disabled}>
            <Animated.View style={{ transform: [{ scale: tap.scale }], opacity: disabled ? INACTIVE_OPACITY : 1 }}>
                <Icon icon={Paperclip} color={theme.foreground} size={24} />
            </Animated.View>
        </Pressable>
    );
});

function ImageButton({ onPress, disabled = false }) {
    const { theme } = useTheme();
    const tap = useTap({
        onPress,
        disabled,
        hapticIn: 'selection',
    });

    return (
        <Pressable {...tap.props} style={{ alignSelf: 'flex-end', marginBottom: -2 }} hitSlop={12} disabled={disabled}>
            <Animated.View style={{ transform: [{ scale: tap.scale }], opacity: disabled ? INACTIVE_OPACITY : 1 }}>
                <Icon icon={ImageIcon} color={theme.foreground} size={24} />
            </Animated.View>
        </Pressable>
    );
}

function MoneyButton({ onPress, disabled = false }) {
    const { theme } = useTheme();
    const tap = useTap({
        onPress,
        disabled,
        hapticIn: 'selection',
    });

    return (
        <Pressable {...tap.props} style={{ alignSelf: 'flex-end', marginBottom: -2 }} hitSlop={12} disabled={disabled}>
            <Animated.View style={{ transform: [{ scale: tap.scale }], opacity: disabled ? INACTIVE_OPACITY : 1 }}>
                <Icon icon={HandCoins} color={theme.foreground} size={24} />
            </Animated.View>
        </Pressable>
    );
}

function PopScale({ show, children, onHidden, animateIn = true, enterDelayMs = 0 }) {
    const scale = useSharedValue(show && !animateIn ? 1 : COMPOSER_POP_FROM);

    useEffect(() => {
        if (show && !animateIn) {
            scale.value = 1;
            return undefined;
        }
        let timer = null;
        const animate = () => {
            scale.value = withTiming(show ? 1 : COMPOSER_POP_FROM, show ? composerPopInTiming : composerPopOutTiming, (finished) => {
                if (finished && !show && onHidden) {
                    runOnJS(onHidden)();
                }
            });
        };
        if (show && enterDelayMs > 0) {
            scale.value = COMPOSER_POP_FROM;
            timer = setTimeout(animate, enterDelayMs);
        } else {
            animate();
        }
        return () => {
            if (timer) {
                clearTimeout(timer);
            }
        };
    }, [animateIn, enterDelayMs, onHidden, scale, show]);

    const style = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    return <Reanimated.View style={style}>{children}</Reanimated.View>;
}

function getAttachmentDraftTitle(msg) {
    if (typeof msg?.n === 'string' && msg.n.trim()) {
        return msg.n.trim();
    }

    switch (msg?.t) {
        case 'img':
            return 'image';
        case 'mp3':
            return 'audio';
        case 'mp4':
            return 'video';
        case 'file':
            return 'file';
        default:
            return '';
    }
}

function getDraftPreview(msg, context) {
    if (!msg) {
        return '';
    }
    if (msg?.t === 'req') {
        return getRequestContext(msg, context).text;
    }
    const attachmentTitle = getAttachmentDraftTitle(msg);
    if (attachmentTitle) {
        return attachmentTitle;
    }
    if (typeof msg?.c === 'string' && msg.c.trim()) {
        return msg.c.trim();
    }
    return 'message';
}

function getDraftTypeIcon(msg) {
    switch (msg?.t) {
        case 'img':
            return ImageIcon;
        case 'mp3':
            return AudioLines;
        case 'mp4':
            return Film;
        case 'file':
            return File;
        case 'req':
            return HandCoins;
        default:
            return null;
    }
}

export function DraftBar({ draft, peerDisplayName, onClear, onHidden }) {
    const { theme } = useTheme();
    const { settings } = useUser();
    const bitcoin = useBitcoin();
    const { getTxById } = useTxData();
    const [mounted, setMounted] = useState(!!draft);
    const [visibleDraft, setVisibleDraft] = useState(draft);
    const clearTap = useTap({
        onPress: onClear,
        hapticIn: false,
        hapticOut: 'soft',
        hapticPress: false,
    });
    const hideDraft = useCallback(() => {
        setMounted(false);
        setVisibleDraft(null);
        onHidden?.();
    }, [onHidden]);

    useEffect(() => {
        if (draft) {
            setVisibleDraft(draft);
            setMounted(true);
        }
    }, [draft]);

    const shownDraft = draft || visibleDraft;
    const DraftTypeIcon = shownDraft ? getDraftTypeIcon(shownDraft.msg) : null;

    if (!mounted || !shownDraft) {
        return null;
    }

    return (
        <PopScale show={!!draft} onHidden={hideDraft} enterDelayMs={COMPOSER_POP_MS}>
            <GlassView
                glassEffectStyle="regular"
                tintColor={theme.glassBackgroundSoft}
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    borderRadius: 20,
                    paddingLeft: 14,
                    paddingRight: 12,
                    paddingVertical: 10,
                }}
            >
                <Icon icon={shownDraft.mode === 'edit' ? SquarePen : Reply} color={theme.foreground} size={21} />
                {DraftTypeIcon ? <Icon icon={DraftTypeIcon} color={theme.muted} size={18} /> : null}
                <Animated.View style={{ flex: 1 }}>
                    <Animated.Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.foreground, fontSize: 15, fontWeight: '800' }}>
                        {getDraftPreview(shownDraft.msg, { fromPeer: shownDraft.fromPeer, peerDisplayName, moneyFormat: settings?.moneyFormat, btcPrice: bitcoin?.price, getTxById })}
                    </Animated.Text>
                </Animated.View>
                <Pressable {...clearTap.props} hitSlop={10}>
                    <Animated.View style={{ transform: [{ scale: clearTap.scale }] }}>
                        <Icon icon={X} color={theme.muted} size={22} />
                    </Animated.View>
                </Pressable>
            </GlassView>
        </PopScale>
    );
}

function getCommandPrefix(item) {
    const token = String(item ?? '').trim().split(/\s+/)[0];
    return token ? `${token} ` : '';
}

function splitCommandHint(item) {
    const text = String(item ?? '').trim();
    if (!text) {
        return { prefix: '', rest: '' };
    }
    const [prefix, ...rest] = text.split(/\s+/);
    return { prefix, rest: rest.join(' ') };
}

function CommandBubble({ item, onSelect, interactive = true }) {
    const { theme } = useTheme();
    const { prefix, rest } = splitCommandHint(item);
    const tap = useTap({
        onPress: () => onSelect?.(getCommandPrefix(item)),
        disabled: !interactive,
        hapticIn: 'selection',
    });

    const body = (
        <GlassView
            glassEffectStyle="regular"
            tintColor={theme.background}
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                borderRadius: 20,
                paddingHorizontal: 14,
                paddingVertical: 10,
            }}
        >
            <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '800' }}>{prefix}</Text>
            {rest ? <Text style={{ color: theme.muted, fontSize: 15, fontWeight: '800' }}>{rest}</Text> : null}
        </GlassView>
    );

    if (!interactive) {
        return body;
    }

    return (
        <Pressable {...tap.props} hitSlop={8}>
            <Animated.View style={{ transform: [{ scale: tap.scale }] }}>{body}</Animated.View>
        </Pressable>
    );
}

export function CommandBubbles({ items, onSelect, interactive = true }) {
    const activeItems = useMemo(() => (Array.isArray(items) ? items.filter(Boolean) : []), [items]);
    const activeKey = activeItems.join('\n');
    const activeSet = useMemo(() => new Set(activeItems), [activeKey]);
    const previousActiveRef = useRef(activeItems);
    const [renderItems, setRenderItems] = useState(activeItems);
    const [animateItemsIn, setAnimateItemsIn] = useState(true);

    useEffect(() => {
        const previousActive = previousActiveRef.current;
        const previousHadActive = previousActive.length > 0;
        previousActiveRef.current = activeItems;

        if (activeItems.length) {
            setAnimateItemsIn(!previousHadActive);
            setRenderItems(activeItems);
            return undefined;
        }

        setAnimateItemsIn(false);
        setRenderItems((current) => (current.length ? current : previousActive));

        const timer = setTimeout(() => {
            setRenderItems((current) => current.filter((item) => activeSet.has(item)));
        }, COMPOSER_POP_EXIT_HOLD_MS);
        return () => clearTimeout(timer);
    }, [activeItems, activeKey, activeSet]);

    if (!renderItems.length) {
        return null;
    }

    return (
        <Reanimated.View collapsable={false} layout={composerLayout} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {renderItems.map((item) => (
                <Reanimated.View key={item} layout={composerLayout}>
                    <PopScale show={activeSet.has(item)} animateIn={animateItemsIn}>
                        <CommandBubble item={item} onSelect={onSelect} interactive={interactive} />
                    </PopScale>
                </Reanimated.View>
            ))}
        </Reanimated.View>
    );
}

function ChatInput({ onLayout, onSend, onEditMessage, onSendImage, onSendAttachment, onSendMoney, onCommand, onCommandChange, inputApiRef, draft, onClearDraft, draftKey }) {
    const { theme } = useTheme();

    const inputRef = useRef(null);
    const messageRef = useRef('');
    const [message, setMessage] = useState('');
    const canSend = message.trim().length > 0;
    const parsedCommand = draft?.mode !== 'edit' && message.startsWith('/') ? parseCommand(message, { mode: 'chat' }) : null;

    const handleChange = useCallback((e) => {
        const text = e?.nativeEvent?.text ?? '';
        messageRef.current = text;
        setMessage((current) => (current === text ? current : text));
        onCommandChange?.(text);
    }, [onCommandChange]);

    useEffect(() => {
        if (!inputApiRef) {
            return;
        }
        inputApiRef.current = {
            setText(next) {
                const text = String(next ?? '');
                messageRef.current = text;
                setMessage(text);
                onCommandChange?.(text);
                requestAnimationFrame(() => {
                    inputRef.current?.focus?.();
                });
            },
        };
        return () => {
            if (inputApiRef.current) {
                inputApiRef.current = null;
            }
        };
    }, [inputApiRef, onCommandChange]);

    const handleSend = useCallback(() => {
        const toSend = messageRef.current.trim();
        if (!toSend) return;
        if (parsedCommand) {
            if (!parsedCommand.complete) {
                return;
            }
            messageRef.current = '';
            setMessage('');
            onCommandChange?.('');
            onClearDraft?.();
            inputRef.current?.focus?.();
            Promise.resolve(onCommand?.(parsedCommand)).catch(() => {});
            return;
        }
        if (draft?.mode === 'edit') {
            messageRef.current = '';
            setMessage('');
            onCommandChange?.('');
            onClearDraft?.();
            inputRef.current?.focus?.();
            Promise.resolve(onEditMessage?.(draft.msg, toSend)).catch(() => {});
            return;
        }
        messageRef.current = '';
        setMessage('');
        onCommandChange?.('');
        const nextDraft = draft;
        onClearDraft?.();
        inputRef.current?.focus?.();
        Promise.resolve(onSend?.(toSend, nextDraft)).catch(() => {});
    }, [draft, onClearDraft, onCommand, onCommandChange, onEditMessage, onSend, parsedCommand]);

    const handlePickImage = useCallback(async () => {
        mark('chat.imagePicker.start', {});
        try {
            const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
            mark('chat.imagePicker.permission.existing', { granted: !!existing.granted, status: existing.status || '', accessPrivileges: existing.accessPrivileges || '' });
            const perm = existing.granted ? existing : await ImagePicker.requestMediaLibraryPermissionsAsync();

            if (!perm.granted) {
                mark('chat.imagePicker.permission.denied', { status: perm.status || '', accessPrivileges: perm.accessPrivileges || '' });
                Alert.alert('Permission needed', 'Please allow photo access to choose media.');
                return;
            }

            mark('chat.imagePicker.launch.start', {});
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images', 'videos'],
                quality: 0.85,
                shouldDownloadFromNetwork: true,
            });
            mark('chat.imagePicker.launch.done', { canceled: !!result.canceled, assets: result.assets?.length || 0, firstType: result.assets?.[0]?.mimeType || '', firstUri: result.assets?.[0]?.uri || '' });

            if (result.canceled || !result.assets?.length) return;
            mark('chat.imagePicker.send.start', { mimeType: result.assets[0]?.mimeType || '', width: result.assets[0]?.width || 0, height: result.assets[0]?.height || 0, fileSize: result.assets[0]?.fileSize || result.assets[0]?.size || 0 });
            Promise.resolve(onSendImage?.(result.assets[0])).catch(() => {});
        } catch (e) {
            mark('chat.imagePicker.error', { message: e?.message || String(e), code: e?.code || '', type: e?.name || e?.constructor?.name || '' });
            console.warn('chat image picker failed', e);
            Alert.alert('Picker failed', 'Could not open the selected media. Please try another photo or video.');
        }
    }, [onSendImage]);

    const handlePickAttachment = useCallback(async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                multiple: false,
                copyToCacheDirectory: true,
                type: '*/*',
            });

            if (result.canceled || !result.assets?.length) return;
            Promise.resolve(onSendAttachment?.(result.assets[0])).catch(() => {});
        } catch (e) {
            console.warn('chat attachment picker failed', e);
        }
    }, [onSendAttachment]);

    useEffect(() => {
        if (!draftKey) {
            return;
        }
        if (draft?.mode === 'edit') {
            const text = typeof draft?.msg?.c === 'string' ? draft.msg.c : '';
            messageRef.current = text;
            setMessage(text);
            onCommandChange?.(text);
        }
        requestAnimationFrame(() => {
            inputRef.current?.focus?.();
        });
    }, [draft, draftKey, onCommandChange]);

    return (
        <GlassView
            glassEffectStyle="regular"
            tintColor={theme.glassBackgroundSoft}
            onLayout={onLayout}
            style={{
                flexDirection: 'row',
                paddingLeft: 16,
                paddingRight: 10,
                borderRadius: 24,
                paddingTop: 6,
                paddingBottom: 10,
                gap: 10,
                alignItems: 'flex-end',
            }}
        >
            <TextInput
                ref={inputRef}
                value={message}
                onChange={handleChange}
                placeholder="send a message"
                placeholderTextColor={theme.muted}
                style={{
                    flex: 1,
                    color: theme.foreground,
                    fontSize: 18,
                    maxHeight: 120,
                }}
                multiline
                returnKeyType="default"
            />
            {canSend ? (
                <SendButton canSend={canSend} onPress={handleSend} />
            ) : (
                <>
                    <ImageButton onPress={handlePickImage} disabled={!onSendImage} />
                    <AttachButton onPress={handlePickAttachment} disabled={!onSendAttachment} />
                    <MoneyButton onPress={onSendMoney} disabled={!onSendMoney} />
                </>
            )}
        </GlassView>
    );
}

export default memo(ChatInput);
