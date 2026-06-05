import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Animated as RNAnimated, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, Download, Share2, Volume2, VolumeX } from 'lucide-react-native';
import Animated from 'react-native-reanimated';
import { canShareAttachmentMsg } from '@veyl/shared/chat/messages';
import Icon from '@/components/icon';
import { downloadMessageFile, downloadMessageImage } from '@/lib/chat/downloads';
import { stageShareMedia } from '@/lib/chat/share';
import { usePop } from '@/lib/pop';
import { useTap } from '@/lib/tap';

export const ACTION_ROW_H = 48;
export const ACTION_ROW_GAP = 6;

const MENU_OUT_MS = 160;

function ActionIconButton({ children, disabled = false, onPress }) {
    const tap = useTap({ disabled, onPress, hapticOut: 'soft' });

    return (
        <Pressable {...tap.props} disabled={disabled} hitSlop={12}>
            <RNAnimated.View
                style={{
                    width: ACTION_ROW_H,
                    height: ACTION_ROW_H,
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: [{ scale: tap.scale }],
                }}
            >
                {children}
            </RNAnimated.View>
        </Pressable>
    );
}

export function ViewerMenu({ activeIsVideo, activeItem, muted, muteStyle, onToggleMuted, downloadStyle, theme }) {
    const router = useRouter();
    const [downloading, setDownloading] = useState(false);
    const [downloadedId, setDownloadedId] = useState(null);
    const mutePop = usePop({ show: activeIsVideo, from: 0.58, enterBounce: 16, exitDuration: MENU_OUT_MS });
    const downloaded = !!activeItem && downloadedId === activeItem.id;
    const downloadDisabled = downloading || downloaded || !activeItem;
    const shareDisabled = !canShareAttachmentMsg(activeItem?.msg);

    useEffect(() => {
        setDownloadedId(null);
    }, [activeItem?.id]);

    const downloadActiveMedia = useCallback(async () => {
        if (downloadDisabled || !activeItem) {
            return;
        }

        setDownloading(true);
        try {
            if (activeItem.type === 'img') {
                await downloadMessageImage(activeItem.msg, activeItem.peerChatPK, activeItem.readMessageFile);
            } else {
                await downloadMessageFile(activeItem.msg, activeItem.peerChatPK, activeItem.readMessageFile);
            }
            setDownloadedId(activeItem.id);
        } catch (error) {
            console.warn('viewer media download failed', error);
        } finally {
            setDownloading(false);
        }
    }, [activeItem, downloadDisabled]);

    const shareActiveMedia = useCallback(() => {
        if (!activeItem?.msg || !canShareAttachmentMsg(activeItem.msg)) {
            return;
        }
        const params = stageShareMedia(activeItem.msg, { sourcePeerChatPK: activeItem.peerChatPK });
        if (!params) {
            return;
        }
        router.push({ pathname: '/sharemedia', params });
    }, [activeItem, router]);

    return (
        <View
            style={{
                height: ACTION_ROW_H,
                marginTop: ACTION_ROW_GAP,
                paddingHorizontal: 18,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
            }}
        >
            <Animated.View pointerEvents={mutePop.pointerEvents} style={muteStyle}>
                <RNAnimated.View style={mutePop.childStyle}>
                    <ActionIconButton onPress={onToggleMuted} disabled={!activeIsVideo}>
                        <Icon icon={muted ? VolumeX : Volume2} size={24} color={theme.foreground} />
                    </ActionIconButton>
                </RNAnimated.View>
            </Animated.View>
            <Animated.View style={downloadStyle}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: ACTION_ROW_GAP }}>
                    <ActionIconButton onPress={shareActiveMedia} disabled={shareDisabled}>
                        <Icon icon={Share2} size={24} color={theme.foreground} />
                    </ActionIconButton>
                    <ActionIconButton onPress={downloadActiveMedia} disabled={downloadDisabled}>
                        {downloading ? <ActivityIndicator color={theme.foreground} /> : <Icon icon={downloaded ? Check : Download} size={24} color={theme.foreground} />}
                    </ActionIconButton>
                </View>
            </Animated.View>
        </View>
    );
}
