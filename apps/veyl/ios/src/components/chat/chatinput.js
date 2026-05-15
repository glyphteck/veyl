import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, Text, TextInput } from 'react-native';
import { ArrowRightCircle, HandCoins, Image as ImageIcon, Paperclip, Reply, SquarePen, X } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/providers/themeprovider';
import { useTap } from '@/lib/tap';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import { parseCommand } from '@glyphteck/shared/commands';

const INACTIVE_OPACITY = 0.32;

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

function getDraftPreview(msg) {
    if (!msg) {
        return '';
    }
    if (msg?.t === 'req') {
        return 'payment request';
    }
    if (typeof msg?.c === 'string' && msg.c.trim()) {
        return msg.c.trim();
    }
    if (typeof msg?.n === 'string' && msg.n.trim()) {
        return msg.n.trim();
    }
    if (msg?.t === 'img') {
        return 'image';
    }
    if (msg?.t === 'file' || msg?.t === 'mp3' || msg?.t === 'mp4') {
        return 'attachment';
    }
    return 'message';
}

export function DraftBar({ draft, onClear }) {
    const { theme } = useTheme();
    const clearTap = useTap({
        onPress: onClear,
        hapticIn: false,
        hapticOut: 'soft',
        hapticPress: false,
    });

    if (!draft) {
        return null;
    }

    return (
        <GlassView
            glassEffectStyle="regular"
            tintColor={theme.background}
            style={{
                marginBottom: 8,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                borderRadius: 20,
                paddingLeft: 14,
                paddingRight: 12,
                paddingVertical: 10,
            }}
        >
            <Icon icon={draft.mode === 'edit' ? SquarePen : Reply} color={theme.foreground} size={21} />
            <Animated.View style={{ flex: 1 }}>
                <Animated.Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.foreground, fontSize: 15, fontWeight: '800' }}>
                    {getDraftPreview(draft.msg)}
                </Animated.Text>
            </Animated.View>
            <Pressable {...clearTap.props} hitSlop={10}>
                <Animated.View style={{ transform: [{ scale: clearTap.scale }] }}>
                    <Icon icon={X} color={theme.muted} size={22} />
                </Animated.View>
            </Pressable>
        </GlassView>
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
    if (!items?.length) {
        return null;
    }

    return (
        <Animated.View style={{ marginBottom: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {items.map((item) => (
                <CommandBubble key={item} item={item} onSelect={onSelect} interactive={interactive} />
            ))}
        </Animated.View>
    );
}

function ChatInput({ nativeID, onLayout, onSend, onEditMessage, onSendImage, onSendAttachment, onSendMoney, onCommand, onCommandChange, inputApiRef, draft, onClearDraft, draftKey }) {
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
            Promise.resolve(onCommand?.(parsedCommand)).catch((e) => {
                console.warn('chat command failed', e);
            });
            return;
        }
        if (draft?.mode === 'edit') {
            messageRef.current = '';
            setMessage('');
            onCommandChange?.('');
            onClearDraft?.();
            inputRef.current?.focus?.();
            Promise.resolve(onEditMessage?.(draft.msg, toSend))
                .catch((e) => {
                    console.warn('chat edit failed', e);
                });
            return;
        }
        messageRef.current = '';
        setMessage('');
        onCommandChange?.('');
        const nextDraft = draft;
        onClearDraft?.();
        inputRef.current?.focus?.();
        Promise.resolve(onSend?.(toSend, nextDraft)).catch((e) => {
            console.warn('chat send failed', e);
        });
    }, [draft, onClearDraft, onCommand, onCommandChange, onEditMessage, onSend, parsedCommand]);

    const handlePickImage = useCallback(async () => {
        try {
            const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
            const perm = existing.granted ? existing : await ImagePicker.requestMediaLibraryPermissionsAsync();

            if (!perm.granted) {
                Alert.alert('Permission needed', 'Please allow photo access to choose a picture.');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images', 'videos'],
                quality: 0.85,
                videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
            });

            if (result.canceled || !result.assets?.length) return;
            Promise.resolve(onSendImage?.(result.assets[0])).catch((e) => {
                console.warn('chat image send failed', e);
            });
        } catch (e) {
            console.warn('chat image picker failed', e);
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
            Promise.resolve(onSendAttachment?.(result.assets[0])).catch((e) => {
                console.warn('chat attachment send failed', e);
            });
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
        inputRef.current?.focus?.();
    }, [draft, draftKey, onCommandChange]);

    return (
        <GlassView
            glassEffectStyle="regular"
            tintColor={theme.background}
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
                nativeID={nativeID}
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
