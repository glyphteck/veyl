import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated as RNAnimated, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { BanknoteArrowUp, ChevronLeft, Eye, EyeOff, KeyRound, Lock, Trash2 } from 'lucide-react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import GlassButton from '@/components/glass/glassbutton';
import GlassField from '@/components/glass/glassfield';
import GlassHeader from '@/components/glass/glassheader';
import GlassIcon from '@/components/glass/glassicon';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import { auth, functions } from '@/lib/firebase';
import { clearFaceIdPassword } from '@/lib/faceid';
import { dropPush } from '@/lib/push';
import { useTap } from '@/lib/tap';
import { userAvatarCache } from '@/lib/useravatarcache';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import { useWallet } from '@/providers/walletprovider';
import { useChat } from '@/providers/chatprovider';
import { renderMoney } from '@glyphteck/shared/utils';
import { verifyVaultPassword } from '@/lib/crypto/seed';

function getVaultError(error) {
    if (error?.message === 'password required') {
        return 'enter your password';
    }
    if (error?.message === 'vault not ready') {
        return 'your vault is still loading. try again in a moment.';
    }
    return 'incorrect password';
}

export default function DeleteAccountScreen() {
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const buttonColor = theme.background;
    const router = useRouter();
    const { encSeed, localCache, lock } = useVault();
    const { collectAccountSavedMediaStays, releaseSavedMediaStays } = useChat();
    const { uid, settings, clearAvatar } = useUser();
    const bitcoin = useBitcoin();
    const { balance } = useWallet();
    const openRef = useRef(true);
    const [step, setStep] = useState('intro');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [isVerified, setIsVerified] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const showWithdraw = Number(balance ?? 0) > 0;
    const balanceLabel = renderMoney(balance ?? 0n, settings.moneyFormat, bitcoin.price);
    const lockPulse = useSharedValue(1);
    const lockAnimStyle = useAnimatedStyle(() => ({ opacity: lockPulse.value }));

    const backTap = useTap({
        disabled: isDeleting,
        onPress: () => {
            router.back();
        },
    });

    const eyeFeedback = useTap({
        disabled: isVerifying || isDeleting,
        onPress: () => setShowPassword((prev) => !prev),
    });

    useEffect(() => {
        return () => {
            openRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (step !== 'unlock') {
            cancelAnimation(lockPulse);
            lockPulse.value = 1;
            return;
        }

        if (isVerifying) {
            cancelAnimation(lockPulse);
            lockPulse.value = 0;

            lockPulse.value = withSequence(
                withTiming(1, { duration: 600 }),
                withRepeat(withSequence(withTiming(1, { duration: 600 }), withTiming(0, { duration: 400 }), withTiming(1, { duration: 600 })), -1, false)
            );
            return;
        }

        cancelAnimation(lockPulse);
        lockPulse.value = 1;

        return () => {
            cancelAnimation(lockPulse);
        };
    }, [isVerifying, lockPulse, step]);

    const handlePasswordChange = useCallback((value) => {
        setPassword(value.slice(0, 64));
        setError('');
        setIsVerified(false);
    }, []);

    const yieldToUi = useCallback(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => setTimeout(resolve, 0));
    }, []);

    const handleVerify = useCallback(async () => {
        if (isVerifying || isDeleting) return;

        Keyboard.dismiss();
        setIsVerifying(true);
        setError('');

        try {
            await yieldToUi();
            await verifyVaultPassword(encSeed, password);
            if (openRef.current) {
                setIsVerified(true);
                setPassword('');
                setShowPassword(false);
                setStep('confirm');
            }
        } catch (err) {
            if (openRef.current) {
                setIsVerified(false);
                setError(getVaultError(err));
            }
        } finally {
            if (openRef.current) {
                setIsVerifying(false);
            }
        }
    }, [encSeed, isDeleting, isVerifying, password, yieldToUi]);

    const handleDelete = useCallback(async () => {
        if (!uid || !isVerified || isDeleting) return;

        setIsDeleting(true);

        try {
            const savedMediaStays = await collectAccountSavedMediaStays?.();
            await dropPush({ uid }).catch(() => {});
            await httpsCallable(functions, 'deleteAccount')();
            await releaseSavedMediaStays?.(savedMediaStays)?.catch(() => {});
            await localCache?.clear?.().catch(() => {});
            clearAvatar?.();
            await clearFaceIdPassword(uid).catch(() => {});
            await userAvatarCache.forget?.(uid).catch(() => {});
            lock?.();
            await signOut(auth).catch(() => {});
        } catch (err) {
            console.warn('delete account failed', err);
            if (openRef.current) {
                Alert.alert('Delete failed', err?.message || 'Failed to delete account.');
                setIsDeleting(false);
            }
        }
    }, [clearAvatar, collectAccountSavedMediaStays, isDeleting, isVerified, localCache, lock, releaseSavedMediaStays, uid]);

    const WarningCopy = () => (
        <GlassView glassEffectStyle="clear" tintColor={theme.background} style={{ borderRadius: 24, paddingHorizontal: 18, paddingVertical: 18, gap: 12 }}>
            {showWithdraw ? (
                <Text style={{ fontSize: 16, lineHeight: 24, color: theme.muted }}>
                    balance: <Text style={{ color: theme.foreground, fontWeight: '900' }}>{balanceLabel}</Text>
                </Text>
            ) : null}
            <Text style={{ fontSize: 18, lineHeight: 27, color: theme.foreground }}>
                if you choose to delete your account, <Text style={{ color: theme.destructive, fontWeight: '900' }}>you will permanently lose access to your funds and chats</Text>. you can withdraw your funds first to a bitcoin wallet before
                deleting your account, export your wallet to a different client, or simply send your remaining balance to another account.
            </Text>
        </GlassView>
    );

    return (
        <View style={{ flex: 1, backgroundColor: theme.background }}>
            {step === 'intro' ? (
                <>
                    <ScrollView
                        style={{ flex: 1 }}
                        contentContainerStyle={{
                            paddingTop: insets.top + 56,
                            paddingBottom: insets.bottom + 96,
                            paddingHorizontal: 16,
                            gap: 16,
                        }}
                        showsVerticalScrollIndicator={false}
                        bounces
                        alwaysBounceVertical
                    >
                        <View style={{ gap: 10 }}>
                            <Text style={{ fontSize: 28, fontWeight: '900', color: theme.foreground }}>delete account?</Text>
                            <WarningCopy />
                        </View>
                    </ScrollView>

                    <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <GlassIcon icon={BanknoteArrowUp} onPress={() => router.push('/withdraw')} disabled={!showWithdraw} />
                        <GlassButton onPress={() => setStep('unlock')} label="delete account" tintColor={theme.destructive} color={theme.background} icon={Trash2} pressableStyle={{ flex: 1 }} />
                        <GlassIcon icon={KeyRound} onPress={() => router.push('/exportwallet')} />
                    </View>
                </>
            ) : null}

            {step === 'unlock' ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: insets.top + 52, paddingBottom: 140 }}>
                    {isVerifying ? (
                        <View>
                            <View style={{ width: 64, height: 64 }}>
                                <Animated.View style={[{ position: 'absolute' }, lockAnimStyle]}>
                                    <Icon icon={Lock} size={64} color={theme.foreground} />
                                </Animated.View>
                            </View>
                        </View>
                    ) : (
                        <View style={{ width: '100%', maxWidth: 408, paddingHorizontal: 24 }}>
                            <View style={{ width: '100%', maxWidth: 360, gap: 12, alignSelf: 'center' }}>
                                <Text style={{ fontSize: 20, fontWeight: '600', color: theme.foreground }}>{error ? 'wrong password' : 'enter your password'}</Text>

                                <GlassField disabled={isDeleting} style={{ gap: 8, paddingHorizontal: 14 }}>
                                    <Icon icon={Lock} size={22} color={error ? theme.destructive : theme.inflow} />
                                    <TextInput
                                        value={password}
                                        onChangeText={handlePasswordChange}
                                        placeholder="password"
                                        placeholderTextColor={theme.muted}
                                        autoCorrect={false}
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        secureTextEntry={!showPassword}
                                        editable={!isDeleting}
                                        keyboardAppearance={isDark ? 'dark' : 'light'}
                                        returnKeyType="go"
                                        onSubmitEditing={handleVerify}
                                        style={{ flex: 1, fontSize: 20, color: theme.foreground, paddingVertical: 10 }}
                                    />
                                    <Pressable {...eyeFeedback.props} disabled={isDeleting} hitSlop={8}>
                                        <RNAnimated.View style={{ transform: [{ scale: eyeFeedback.scale }] }}>
                                            {showPassword ? <Icon icon={Eye} size={22} color={theme.muted} /> : <Icon icon={EyeOff} size={22} color={theme.muted} />}
                                        </RNAnimated.View>
                                    </Pressable>
                                </GlassField>

                                <GlassButton onPress={handleVerify} accent disabled={!password.trim() || isDeleting} style={{ marginTop: 8 }} label="confirm password" />
                            </View>
                        </View>
                    )}
                </View>
            ) : null}

            {step === 'confirm' ? (
                <>
                    <ScrollView
                        style={{ flex: 1 }}
                        contentContainerStyle={{
                            paddingTop: insets.top + 56,
                            paddingBottom: insets.bottom + 96,
                            paddingHorizontal: 16,
                            gap: 16,
                        }}
                        showsVerticalScrollIndicator={false}
                        bounces
                        alwaysBounceVertical
                    >
                        <View style={{ gap: 14 }}>
                            <Text style={{ fontSize: 28, fontWeight: '900', color: theme.foreground }}>delete account forever?</Text>
                            <WarningCopy />
                        </View>
                    </ScrollView>

                    <GlassButton
                        onPress={handleDelete}
                        disabled={isDeleting}
                        tintColor={theme.destructive}
                        color={theme.background}
                        icon={isDeleting ? null : Trash2}
                        style={{ position: 'absolute', bottom: insets.bottom + 16, left: 16, right: 16 }}
                    >
                        {isDeleting ? (
                            <>
                                <ActivityIndicator color={buttonColor} />
                                <Text style={{ color: buttonColor, fontSize: 17, fontWeight: '800' }}>deleting...</Text>
                            </>
                        ) : (
                            <>
                                <Icon icon={Trash2} size={20} color={buttonColor} />
                                <Text style={{ color: buttonColor, fontSize: 17, fontWeight: '800' }}>delete account</Text>
                            </>
                        )}
                    </GlassButton>
                </>
            ) : null}

            <GlassHeader contentStyle={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                    <Pressable {...backTap.props} hitSlop={10} style={{ justifyContent: 'center' }} disabled={isDeleting}>
                        <RNAnimated.View style={{ transform: [{ scale: backTap.scale }] }}>
                            <Icon icon={ChevronLeft} color={theme.foreground} size={32} />
                        </RNAnimated.View>
                    </Pressable>
                </View>
                <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text numberOfLines={1} style={{ fontSize: 20, fontWeight: '800', color: theme.foreground }}>delete account</Text>
                </View>
                <View style={{ width: 56 }} />
            </GlassHeader>
        </View>
    );
}
