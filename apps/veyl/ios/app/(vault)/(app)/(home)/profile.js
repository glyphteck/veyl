import { Alert, Animated, Pressable, Text, View } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { QrCode, Settings } from 'lucide-react-native';
import AvatarPicker from '@/components/avatarpicker';
import GlassHeader from '@/components/glass/glassheader';
import Icon from '@/components/icon';
import { auth } from '@/lib/firebase';
import { uploadAvatar } from '@/lib/avatarupload';
import { useTap } from '@/lib/tap';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';

export default function Profile() {
    const { theme } = useTheme();
    const router = useRouter();
    const { avatar, uid, username, avatarBanned, refetchAvatar } = useUser();
    const [localAvatar, setLocalAvatar] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const routeLockRef = useRef(false);
    const routeLockTimerRef = useRef(null);
    const effectiveUid = uid || auth.currentUser?.uid;
    const avatarSource = localAvatar ? { uri: localAvatar } : avatar ? { uri: avatar } : null;
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

    const settingsFeedback = useTap({
        onPress: () => {
            if (!lockRoute()) return;
            router.push('/settings');
        },
    });
    const qrFeedback = useTap({
        onPress: () => {
            if (!lockRoute()) return;
            router.push('/scan?type=share');
        },
    });

    const handlePickAvatar = useCallback(
        async (asset) => {
            if (isUploading) return;
            if (!effectiveUid) {
                Alert.alert('Not ready', 'Your profile is still loading. Please try again in a moment.');
                return;
            }
            try {
                setLocalAvatar(asset.uri);
                setIsUploading(true);

                const downloadUrl = await uploadAvatar({
                    uid: effectiveUid,
                    uri: asset.uri,
                    mimeType: asset.mimeType,
                });
                setLocalAvatar(downloadUrl);
                await refetchAvatar();
            } catch (err) {
                console.warn('avatar upload failed', err);
                setLocalAvatar(null);
            } finally {
                setIsUploading(false);
            }
        },
        [effectiveUid, isUploading, refetchAvatar]
    );

    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <GlassHeader pointerEvents="box-none" contentStyle={{ justifyContent: 'space-between', flexDirection: 'row', flex: 1, alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <AvatarPicker size={48} disabled={isUploading || avatarBanned} source={avatarSource} onPick={handlePickAvatar} />
                    <View style={{}}>
                        <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: theme.foreground, fontSize: 28, fontWeight: '700' }}>
                            {username ? `${username}` : ''}
                        </Text>
                    </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
                    <Pressable {...qrFeedback.props} hitSlop={10} style={{ minHeight: 36, justifyContent: 'center' }}>
                        <Animated.View style={{ transform: [{ scale: qrFeedback.scale }] }}>
                            <Icon icon={QrCode} size={26} color={theme.foreground} />
                        </Animated.View>
                    </Pressable>
                    <Pressable {...settingsFeedback.props} hitSlop={10} style={{ minHeight: 36, justifyContent: 'center' }}>
                        <Animated.View style={{ transform: [{ scale: settingsFeedback.scale }] }}>
                            <Icon icon={Settings} size={26} color={theme.foreground} />
                        </Animated.View>
                    </Pressable>
                </View>
            </GlassHeader>
        </View>
    );
}
