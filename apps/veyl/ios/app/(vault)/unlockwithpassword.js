import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated as RNAnimated, Pressable, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Eye, EyeOff, Lock, LockOpen, LogOut, Unlock } from 'lucide-react-native';
import { useRouter } from 'expo-router';

import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import Avatar from '@/components/avatar';
import GlassButton from '@/components/glass/glassbutton';
import GlassField from '@/components/glass/glassfield';
import GlassHeader from '@/components/glass/glassheader';
import Icon from '@/components/icon';
import { hasQuickLoginAccount } from '@/lib/quicklogin';
import { useTap } from '@/lib/tap';
import { logout } from '@/lib/useractions';
import { isPassword, MAX_PASSWORD, normalizePassword } from '@glyphteck/shared/password';

export default function UnlockScreen() {
    const { theme } = useTheme();
    const router = useRouter();
    const { unlockWithPsw, lockState, encSeed, lock } = useVault();
    const user = useUser();

    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [status, setStatus] = useState('idle'); // idle | loading | error
    const [isCovering, setIsCovering] = useState(false);

    const lockOpacity = useRef(new RNAnimated.Value(1)).current;
    const unlockOpacity = useRef(new RNAnimated.Value(0)).current;
    const cover = useSharedValue(0);

    const coverStyle = useAnimatedStyle(() => ({ opacity: cover.value }));

    const seedReady = !!encSeed;
    const isUnlocking = status === 'loading' || lockState === 'unlocking' || lockState === 'seed-decrypted';
    const disabled = isUnlocking || !seedReady || isCovering;

    const labelText = useMemo(() => {
        if (!seedReady) return 'loading your vault';
        if (status === 'error') return 'wrong password';
        return 'unlock your vault';
    }, [status, seedReady]);

    useEffect(() => {
        if (isUnlocking) {
            lockOpacity.setValue(1);
            unlockOpacity.setValue(0);
        } else {
            lockOpacity.setValue(1);
            unlockOpacity.setValue(0);
        }
    }, [isUnlocking, lockOpacity, unlockOpacity]);

    const animateUnlock = useCallback(() => {
        return new Promise((resolve) => {
            RNAnimated.parallel([
                RNAnimated.timing(lockOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
                RNAnimated.timing(unlockOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
            ]).start(resolve);
        });
    }, [lockOpacity, unlockOpacity]);

    // Guards in (vault)/_layout.js handle navigation once unlocked

    const yieldToUi = async () => {
        await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => setTimeout(r, 0));
    };

    const fadeCover = async (toValue, duration = 180) => {
        cover.value = withTiming(toValue, { duration });
        await new Promise((r) => setTimeout(r, duration));
    };

    const swap = async (next) => {
        setIsCovering(true);
        await fadeCover(1);
        next();
        await yieldToUi();
        await fadeCover(0);
        setIsCovering(false);
    };

    const onSubmit = async () => {
        if (!canSubmit) return;
        try {
            await swap(() => setStatus('loading'));
            await unlockWithPsw(normalizePassword(password), { onSeedDecrypted: animateUnlock });
        } catch (err) {
            console.warn('unlock failed', err);
            await swap(() => setStatus('error'));
            setPassword('');
            setTimeout(() => setStatus('idle'), 900);
        }
    };

    const performLogout = async (remember) => {
        try {
            await logout({ remember, account: user, lock });
        } catch (err) {
            console.warn('logout failed', err);
        } finally {
            router.replace('/login');
        }
    };

    const onLogout = async () => {
        if (await hasQuickLoginAccount(user.uid)) {
            await performLogout(true);
            return;
        }
        Alert.alert('remember account?', 'login faster next time', [
            { text: 'no thanks', style: 'cancel', onPress: () => performLogout(false) },
            { text: 'remember', onPress: () => performLogout(true) },
        ]);
    };

    const canSubmit = !disabled && isPassword(password);
    const logoutDisabled = status === 'loading' || lockState === 'unlocking';
    const logoutFeedback = useTap({
        onPress: onLogout,
        disabled: logoutDisabled,
    });
    const eyeFeedback = useTap({ disabled, onPress: () => setShowPassword((prev) => !prev) });

    return (
        <View style={{ flex: 1, backgroundColor: theme.background }}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: isUnlocking ? 0 : 140 }}>
                {!isUnlocking && !isCovering ? (
                    <GlassHeader>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                                <Avatar size={52} source={user?.avatar ? { uri: user.avatar } : null} active={!!user?.active} pointerEvents="none" />
                                <Text numberOfLines={1} style={{ fontSize: 24, fontWeight: '900', color: theme.foreground, maxWidth: 220 }}>
                                    {user?.username || 'profile'}
                                </Text>
                            </View>

                            <Pressable {...logoutFeedback.props} hitSlop={10} disabled={logoutDisabled}>
                                <RNAnimated.View style={{ transform: [{ scale: logoutFeedback.scale }] }}>
                                    <Icon icon={LogOut} size={26} strokeWidth={3} />
                                </RNAnimated.View>
                            </Pressable>
                        </View>
                    </GlassHeader>
                ) : null}

                {isUnlocking ? (
                    <View>
                        <View style={{ width: 64, height: 64 }}>
                            <RNAnimated.View style={{ position: 'absolute', opacity: lockOpacity }}>
                                <Icon icon={Lock} size={64} color={theme.foreground} />
                            </RNAnimated.View>
                            <RNAnimated.View style={{ position: 'absolute', opacity: unlockOpacity }}>
                                <Icon icon={Unlock} size={64} color={theme.active} />
                            </RNAnimated.View>
                        </View>
                    </View>
                ) : (
                    <View style={{ width: '100%', maxWidth: 408, paddingHorizontal: 24 }}>
                        <View style={{ width: '100%', maxWidth: 360, gap: 12, alignSelf: 'center' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <Text style={{ fontSize: 20, fontWeight: '600', color: theme.foreground }}>{labelText}</Text>
                            </View>

                            <GlassField disabled={disabled} style={{ gap: 8, paddingHorizontal: 14 }}>
                                <Icon icon={disabled ? LockOpen : Lock} size={22} color={status === 'error' ? theme.destructive : theme.inflow} />
                                <TextInput
                                    value={password}
                                    onChangeText={(value) => setPassword(value.slice(0, MAX_PASSWORD))}
                                    placeholder="password"
                                    placeholderTextColor={theme.muted}
                                    autoCorrect={false}
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    secureTextEntry={!showPassword}
                                    editable={!disabled}
                                    onSubmitEditing={onSubmit}
                                    returnKeyType="go"
                                    style={{ flex: 1, fontSize: 20, color: theme.foreground, paddingVertical: 10 }}
                                />
                                <Pressable {...eyeFeedback.props} disabled={disabled} hitSlop={8}>
                                    <RNAnimated.View style={{ transform: [{ scale: eyeFeedback.scale }] }}>
                                        {showPassword ? <Icon icon={Eye} size={22} color={theme.muted} /> : <Icon icon={EyeOff} size={22} color={theme.muted} />}
                                    </RNAnimated.View>
                                </Pressable>
                            </GlassField>
                            <Text style={{ color: theme.muted, fontSize: 14 }}>Your chats and funds are encrypted locally and accessible only with your password.</Text>
                            <GlassButton onPress={onSubmit} label="unlock" accent disabled={!canSubmit} style={{ marginTop: 8 }} />
                        </View>
                    </View>
                )}
            </View>
            <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.background, zIndex: 50 }, coverStyle]} />
        </View>
    );
}
