import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated as RNAnimated, Keyboard, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { BanknoteArrowUp, Check, Copy, Eye, EyeOff, Lock } from 'lucide-react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import FloatingHeader, { FloatingHeaderBackIcon, FLOATING_HEADER_SCROLL_EDGE_PAD, getFloatingHeaderHeight } from '@/components/floatingheader';
import GlassButton from '@/components/glass/glassbutton';
import GlassField from '@/components/glass/glassfield';
import GlassIcon from '@/components/glass/glassicon';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import { ScrollEdgeScreen } from '@/lib/navigation/scrolledge';
import { useTap } from '@/lib/tap';
import { useTheme } from '@/providers/themeprovider';
import { useVault } from '@/providers/vaultprovider';
import { isPassword, MAX_PASSWORD, normalizePassword } from '@veyl/shared/password';
import { yieldToUi } from '@veyl/shared/utils/async';
import { decryptWalletMnemonic, zeroBytes } from '@/lib/crypto/seed';

export default function ExportWalletScreen() {
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { vault } = useVault();
    const walletMnemonicRef = useRef(null);

    const [step, setStep] = useState('intro');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [walletMnemonic, setWalletMnemonic] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isRevealed, setIsRevealed] = useState(false);
    const [error, setError] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [copyError, setCopyError] = useState(false);
    const [headerHeight, setHeaderHeight] = useState(() => getFloatingHeaderHeight(insets.top));
    const headerInset = useMemo(() => ({ top: headerHeight }), [headerHeight]);
    const headerOffset = useMemo(() => ({ x: 0, y: -headerHeight }), [headerHeight]);

    const lockPulse = useSharedValue(1);
    const lockAnimStyle = useAnimatedStyle(() => ({ opacity: lockPulse.value }));

    const replaceWalletMnemonic = useCallback((nextMnemonic) => {
        zeroBytes(walletMnemonicRef.current);
        walletMnemonicRef.current = nextMnemonic;
        setWalletMnemonic(nextMnemonic);
    }, []);

    const eyeFeedback = useTap({ disabled: isLoading, onPress: () => setShowPassword((prev) => !prev) });

    const canLoad = !!vault && !isLoading && isPassword(password);
    const mnemonicWords = walletMnemonic ? walletMnemonic.trim().split(/\s+/).filter(Boolean) : [];

    const handlePasswordChange = useCallback(
        (value) => {
            setPassword(value.slice(0, MAX_PASSWORD));
            setError('');
        },
        []
    );

    const handleLoad = useCallback(async () => {
        if (!canLoad) return;

        Keyboard.dismiss();
        setIsLoading(true);
        setError('');

        try {
            await yieldToUi();
            const nextMnemonic = await decryptWalletMnemonic(vault, normalizePassword(password));
            replaceWalletMnemonic(nextMnemonic);
            setPassword('');
            setShowPassword(false);
            setIsRevealed(false);
            setIsCopied(false);
            setCopyError(false);
            setStep('seed');
        } catch (err) {
            setError(err?.message === 'vault not ready' ? 'vault not ready' : 'incorrect password');
        } finally {
            setIsLoading(false);
        }
    }, [canLoad, vault, password, replaceWalletMnemonic, yieldToUi]);

    useEffect(() => {
        if (step !== 'seed') return;
        setPassword('');
        setError('');
    }, [step]);

    useEffect(() => {
        if (step !== 'unlock') {
            cancelAnimation(lockPulse);
            lockPulse.value = 1;
            return;
        }

        if (isLoading) {
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
    }, [isLoading, lockPulse, step]);

    useEffect(() => {
        return () => {
            zeroBytes(walletMnemonicRef.current);
            walletMnemonicRef.current = null;
        };
    }, []);

    return (
        <View style={{ flex: 1, backgroundColor: theme.background }}>
            {step === 'intro' ? (
                <>
                    <ScrollEdgeScreen>
                        <ScrollView
                            style={{ flex: 1 }}
                            contentInset={headerInset}
                            contentOffset={headerOffset}
                            scrollIndicatorInsets={headerInset}
                            contentContainerStyle={{
                                paddingTop: FLOATING_HEADER_SCROLL_EDGE_PAD,
                                paddingBottom: insets.bottom + 88,
                                paddingHorizontal: 16,
                                gap: 16,
                            }}
                            showsVerticalScrollIndicator={false}
                            bounces
                            alwaysBounceVertical
                        >
                            <View style={{ gap: 16 }}>
                                <GlassView glassEffectStyle="clear" tintColor={theme.background} style={{ borderRadius: 28, paddingHorizontal: 18, paddingVertical: 18, gap: 12 }}>
                                    <Text style={{ fontSize: 28, fontWeight: '900', color: theme.foreground }}>this is not a bitcoin wallet.</Text>
                                    <Text style={{ fontSize: 16, lineHeight: 24, color: theme.foreground }}>
                                        you cannot use it like a normal bitcoin wallet. you can only use it with the spark network. either with a new account on this platform, on
                                        a different platform that uses spark wallets, or yourself through the spark sdk.
                                    </Text>
                                </GlassView>

                                <GlassView glassEffectStyle="clear" tintColor={theme.background} style={{ borderRadius: 24, paddingHorizontal: 18, paddingVertical: 18, gap: 10 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                        <Text style={{ flex: 1, fontSize: 22, fontWeight: '900', color: theme.foreground }}>withdraw instead</Text>
                                        <GlassIcon accent icon={BanknoteArrowUp} onPress={() => router.push('/withdraw')} size={54} iconSize={28} />
                                    </View>
                                    <Text style={{ fontSize: 15, lineHeight: 23, color: theme.foreground }}>
                                        if you do not want to use this account anymore, it is highly recommended that you withdraw your funds back to a bitcoin wallet instead.
                                    </Text>
                                </GlassView>
                            </View>
                        </ScrollView>
                    </ScrollEdgeScreen>

                    <GlassButton
                        style={{ position: 'absolute', bottom: insets.bottom + 16, left: 16, right: 16 }}
                        onPress={() => setStep('unlock')}
                        label="i understand"
                        accent
                    />
                </>
            ) : null}

            {step === 'unlock' ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: headerHeight, paddingBottom: 140 }}>
                    {isLoading ? (
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
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <Text style={{ fontSize: 20, fontWeight: '600', color: theme.foreground }}>{error ? 'wrong password' : 'decrypt your wallet'}</Text>
                                </View>

                                <GlassField disabled={isLoading} style={{ gap: 8, paddingHorizontal: 14 }}>
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
                                        editable={!isLoading}
                                        keyboardAppearance={isDark ? 'dark' : 'light'}
                                        onSubmitEditing={handleLoad}
                                        returnKeyType="go"
                                        style={{ flex: 1, fontSize: 20, color: theme.foreground, paddingVertical: 10 }}
                                    />
                                    <Pressable {...eyeFeedback.props} disabled={isLoading} hitSlop={8}>
                                        <RNAnimated.View style={{ transform: [{ scale: eyeFeedback.scale }] }}>
                                            {showPassword ? <Icon icon={Eye} size={22} color={theme.muted} /> : <Icon icon={EyeOff} size={22} color={theme.muted} />}
                                        </RNAnimated.View>
                                    </Pressable>
                                </GlassField>
                                <GlassButton onPress={handleLoad} accent disabled={!canLoad} style={{ marginTop: 8 }} label="unlock" />
                            </View>
                        </View>
                    )}
                </View>
            ) : null}

            {step === 'seed' ? (
                <>
                    <View style={{ flex: 1, paddingTop: headerHeight, paddingHorizontal: 16 }}>
                        {isRevealed ? (
                            <GlassView glassEffectStyle="clear" tintColor={theme.background} style={{ borderRadius: 24, paddingHorizontal: 18, paddingVertical: 18, gap: 10 }}>
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 }}>
                                    {mnemonicWords.map((word, index) => (
                                        <Text
                                            key={`${word}-${index}`}
                                            selectable
                                            style={{
                                                width: '33.3333%',
                                                fontSize: 22,
                                                lineHeight: 28,
                                                fontWeight: '900',
                                                color: theme.foreground,
                                                fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
                                                fontVariant: ['tabular-nums'],
                                            }}
                                        >
                                            {word}
                                        </Text>
                                    ))}
                                </View>
                            </GlassView>
                        ) : null}

                    </View>

                    <View
                        style={{
                            position: 'absolute',
                            left: 16,
                            right: 16,
                            bottom: insets.bottom + 16,
                            gap: 12,
                        }}
                    >
                        <GlassButton
                            onPress={() => setIsRevealed((prev) => !prev)}
                            label={isRevealed ? 'hide mnemonic' : 'show mnemonic'}
                            icon={isRevealed ? Eye : EyeOff}
                            style={{ width: '100%' }}
                        />

                        <GlassButton
                            onPress={() => {
                                if (!walletMnemonic) return;
                                void Clipboard.setStringAsync(walletMnemonic)
                                    .then(() => {
                                        setIsCopied(true);
                                        setCopyError(false);
                                    })
                                    .catch(() => {
                                        setCopyError(true);
                                    });
                            }}
                            label={copyError ? 'copy failed' : isCopied ? 'copied' : 'copy mnemonic'}
                            icon={copyError ? Copy : isCopied ? Check : Copy}
                            style={{ width: '100%' }}
                        />
                    </View>
                </>
            ) : null}

            <FloatingHeader onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
                <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                    <FloatingHeaderBackIcon onPress={() => router.back()} />
                </View>
                <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text numberOfLines={1} style={{ fontSize: 20, fontWeight: '800', color: theme.foreground }}>
                        export wallet
                    </Text>
                </View>
                <View style={{ width: 56 }} />
            </FloatingHeader>
        </View>
    );
}
