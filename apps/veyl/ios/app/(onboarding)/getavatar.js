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
import { useTap } from '@/lib/tap';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';

const ACTION_SWITCH_MS = 80;

export default function NewUserAvatar() {
    const { theme } = useTheme();
    const router = useRouter();
    const { uid, hasAvatarEntry, refetchAvatar, communityRulesVersion, communityRulesAcceptedAt, communityRulesPending } = useUser();
    const { encSeed } = useVault();
    const [selectedAsset, setSelectedAsset] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const hasSelectedAsset = !!selectedAsset;
    const desiredAction = hasSelectedAsset ? 'confirm' : 'skip';
    const [visibleAction, setVisibleAction] = useState(desiredAction);
    const [actionOpen, setActionOpen] = useState(true);
    const visibleActionRef = useRef(desiredAction);
    const actionScaleValue = useRef(new Animated.Value(1)).current;
    const actionTransitionRef = useRef(0);
    const routeLockRef = useRef(false);
    const routeLockTimerRef = useRef(null);
    const acceptedRules = hasCurrentCommunityRules({ communityRulesVersion, communityRulesAcceptedAt, communityRulesPending });
    const isOnboarding = !hasAvatarEntry || !encSeed || !acceptedRules;
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

    const canContinue = hasSelectedAsset && !isUploading;

    useEffect(() => {
        const transition = actionTransitionRef.current + 1;
        actionTransitionRef.current = transition;
        actionScaleValue.stopAnimation();

        if (visibleActionRef.current === desiredAction) {
            setActionOpen(true);
            Animated.timing(actionScaleValue, {
                toValue: 1,
                duration: ACTION_SWITCH_MS,
                useNativeDriver: true,
            }).start();
            return undefined;
        }

        setActionOpen(false);
        Animated.timing(actionScaleValue, {
            toValue: 0,
            duration: ACTION_SWITCH_MS,
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (!finished || actionTransitionRef.current !== transition) return;
            visibleActionRef.current = desiredAction;
            setVisibleAction(desiredAction);
            actionScaleValue.setValue(0);
            setActionOpen(true);
            Animated.timing(actionScaleValue, {
                toValue: 1,
                duration: ACTION_SWITCH_MS,
                useNativeDriver: true,
            }).start();
        });

        return () => {
            actionTransitionRef.current += 1;
            actionScaleValue.stopAnimation();
        };
    }, [actionScaleValue, desiredAction]);

    const continueAfterAvatar = useCallback(() => {
        if (acceptedRules) {
            router.replace(encSeed ? '/wallet' : '/getpassword');
            return;
        }
        router.push('/community');
    }, [acceptedRules, encSeed, router]);

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
            continueAfterAvatar();
        } catch (err) {
            console.warn('avatar skip failed', err);
            Alert.alert('Skip failed', 'Could not update your avatar step. Please try again.');
        } finally {
            setIsUploading(false);
        }
    }, [continueAfterAvatar, isOnboarding, isUploading, lockRoute, router, uid]);

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
            continueAfterAvatar();
        } catch (err) {
            console.warn('avatar upload failed', err);
            Alert.alert('Upload failed', 'Could not upload your avatar. Please try again.');
        } finally {
            setIsUploading(false);
        }
    }, [continueAfterAvatar, isOnboarding, isUploading, lockRoute, refetchAvatar, router, selectedAsset, uid]);

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
                    <Animated.View pointerEvents={actionOpen ? 'auto' : 'none'} style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center', transform: [{ scale: actionScaleValue }] }}>
                        {visibleAction === 'confirm' ? (
                            <GlassButton onPress={handleContinue} icon={ImageUp} label={isUploading ? 'uploading…' : 'confirm'} accent disabled={!canContinue} style={{ width: 256 }} />
                        ) : (
                            <Pressable {...skipFeedback.props} disabled={isUploading}>
                                <Animated.View style={{ transform: [{ scale: skipFeedback.scale }] }}>
                                    <Text style={{ color: theme.muted, fontSize: 16, fontWeight: '600' }}>skip for now</Text>
                                </Animated.View>
                            </Pressable>
                        )}
                    </Animated.View>
                </View>
            </View>
        </View>
    );
}
