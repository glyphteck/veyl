import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ImageUp } from 'lucide-react-native';
import { useTheme } from '@/providers/themeprovider';
import AvatarPicker from '@/components/avatarpicker';
import GlassButton from '@/components/glass/glassbutton';
import { auth } from '@/lib/firebase';
import { skipAvatar, uploadAvatar } from '@/lib/avatarupload';
import { hasCurrentCommunityRules } from '@/lib/community';
import { usePop } from '@/lib/pop';
import { useTap } from '@/lib/tap';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';

export default function NewUserAvatar() {
    const { theme } = useTheme();
    const router = useRouter();
    const { uid, refetchAvatar, communityRulesVersion, communityRulesAcceptedAt, communityRulesPending } = useUser();
    const { encSeed } = useVault();
    const [selectedAsset, setSelectedAsset] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const routeLockRef = useRef(false);
    const routeLockTimerRef = useRef(null);
    const acceptedRules = hasCurrentCommunityRules({ communityRulesVersion, communityRulesAcceptedAt, communityRulesPending });
    const isOnboarding = !encSeed || !acceptedRules;
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
    const confirmPop = usePop({ show: !!selectedAsset, from: 0.8, enterBounce: 12, exitDuration: 130 });
    const skipPop = usePop({ show: !selectedAsset, from: 0.8, enterBounce: 12, exitDuration: 130 });
    const handleSkip = useCallback(async () => {
        if (isUploading) return;

        if (!isOnboarding) {
            if (!lockRoute()) return;
            router.back();
            return;
        }

        const effectiveUid = uid || auth.currentUser?.uid;
        if (!effectiveUid) {
            Alert.alert('Not ready', 'Your profile is still loading. Please try again in a moment.');
            return;
        }

        try {
            setIsUploading(true);
            await skipAvatar({ uid: effectiveUid });
            if (!lockRoute()) return;
            if (acceptedRules) {
                router.replace('/getpassword');
                return;
            }
            router.push('/community');
        } catch (err) {
            console.warn('avatar skip failed', err);
            Alert.alert('Skip failed', 'Could not update your avatar step. Please try again.');
        } finally {
            setIsUploading(false);
        }
    }, [acceptedRules, isOnboarding, isUploading, lockRoute, router, uid]);

    const skipFeedback = useTap({
        disabled: isUploading,
        onPress: () => {
            void handleSkip();
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
            await refetchAvatar?.({ optimistic: true });
            if (!lockRoute()) return;
            if (!isOnboarding) {
                router.back();
                return;
            }
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
    }, [acceptedRules, isOnboarding, isUploading, lockRoute, refetchAvatar, router, selectedAsset, uid]);

    const handleRemoveAvatar = useCallback(() => {
        if (isUploading) return;
        setSelectedAsset(null);
    }, [isUploading]);

    return (
        <View style={{ flex: 1, padding: 24 }}>
            <View style={{ position: 'absolute', top: '36%', left: 24, right: 24, alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 28, fontWeight: '900', color: theme.foreground, textAlign: 'center' }}>set your avatar</Text>
                <AvatarPicker
                    size={140}
                    disabled={isUploading}
                    onPick={setSelectedAsset}
                    onRemove={handleRemoveAvatar}
                    removeDisabled={isUploading}
                    showRemove={!!selectedAsset && !isUploading}
                    source={selectedAsset ? { uri: selectedAsset.uri } : null}
                />
            </View>

            <View style={{ position: 'absolute', left: 24, right: 24, bottom: '14%', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 256, height: 54, alignItems: 'center', justifyContent: 'center' }}>
                    <Animated.View pointerEvents={confirmPop.pointerEvents} style={[{ position: 'absolute', width: 256 }, confirmPop.childStyle]}>
                        <GlassButton onPress={handleContinue} icon={ImageUp} label={isUploading ? 'uploading…' : 'confirm'} accent disabled={!canContinue} style={{ width: 256 }} />
                    </Animated.View>
                    <Pressable {...skipFeedback.props} disabled={isUploading} pointerEvents={skipPop.pointerEvents} style={{ position: 'absolute' }}>
                        <Animated.View style={[skipPop.childStyle, { opacity: isUploading ? 0.4 : 1 }]}>
                            <Animated.View style={{ transform: [{ scale: skipFeedback.scale }] }}>
                                <Text style={{ color: theme.muted, fontSize: 16, fontWeight: '600' }}>skip for now</Text>
                            </Animated.View>
                        </Animated.View>
                    </Pressable>
                </View>
            </View>
        </View>
    );
}
