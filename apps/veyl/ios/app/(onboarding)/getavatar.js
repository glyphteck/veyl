import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ImageUp } from 'lucide-react-native';
import { useTheme } from '@/providers/themeprovider';
import AvatarPicker from '@/components/avatarpicker';
import GlassButton from '@/components/glass/glassbutton';
import { auth } from '@/lib/firebase';
import { uploadAvatar } from '@/lib/avatarupload';
import { hasCurrentCommunityRules } from '@/lib/community';
import { useTap } from '@/lib/tap';
import { useUser } from '@/providers/userprovider';

export default function NewUserAvatar() {
    const { theme } = useTheme();
    const router = useRouter();
    const { uid, refetchAvatar, communityRulesVersion, communityRulesAcceptedAt, communityRulesPending } = useUser();
    const [selectedAsset, setSelectedAsset] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const routeLockRef = useRef(false);
    const routeLockTimerRef = useRef(null);
    const acceptedRules = hasCurrentCommunityRules({ communityRulesVersion, communityRulesAcceptedAt, communityRulesPending });
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

    const canContinue = !!selectedAsset && !isUploading;
    const skipFeedback = useTap({
        disabled: isUploading,
        onPress: () => {
            if (!lockRoute()) return;
            if (acceptedRules) {
                router.replace('/getpassword');
                return;
            }
            router.push('/community');
        },
    });

    const handleContinue = useCallback(async () => {
        if (!selectedAsset) return;
        if (isUploading) return;

        const effectiveUid = uid || auth.currentUser?.uid;
        if (!effectiveUid) {
            Alert.alert('Not ready', 'Your profile is still loading. Please try again in a moment.');
            return;
        }

        try {
            setIsUploading(true);
            await uploadAvatar({
                uid: effectiveUid,
                uri: selectedAsset.uri,
                mimeType: selectedAsset.mimeType,
            });
            await refetchAvatar?.();
            if (!lockRoute()) return;
            if (acceptedRules) {
                router.replace('/getpassword');
                return;
            }
            router.push('/community');
        } catch (err) {
            console.warn('avatar upload failed', err);
            Alert.alert('Upload failed', 'Could not upload your avatar. Please try again.');
        } finally {
            setIsUploading(false);
        }
    }, [acceptedRules, isUploading, lockRoute, refetchAvatar, router, selectedAsset, uid]);

    return (
        <View style={{ flex: 1, padding: 24 }}>
            <View style={{ position: 'absolute', top: '36%', left: 24, right: 24, alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 28, fontWeight: '900', color: theme.foreground, textAlign: 'center' }}>set your avatar</Text>
                <AvatarPicker size={140} disabled={isUploading} source={selectedAsset ? { uri: selectedAsset.uri } : null} onPick={setSelectedAsset} />
            </View>

            <View style={{ position: 'absolute', left: 24, right: 24, bottom: '14%', alignItems: 'center', gap: 12 }}>
                <GlassButton onPress={handleContinue} icon={ImageUp} label={isUploading ? 'uploading…' : 'confirm'} accent disabled={!canContinue} style={{ width: 256 }} />
                <Pressable {...skipFeedback.props} disabled={isUploading}>
                    <Animated.View style={{ opacity: isUploading ? 0.4 : 1, transform: [{ scale: skipFeedback.scale }] }}>
                        <Text style={{ color: theme.muted, fontSize: 16, fontWeight: '600' }}>skip for now</Text>
                    </Animated.View>
                </Pressable>
            </View>
        </View>
    );
}
