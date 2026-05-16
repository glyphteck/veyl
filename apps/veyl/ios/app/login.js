import { Animated as RNAnimated, Pressable, ScrollView, Text, ActivityIndicator, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { Fingerprint, UserRoundPlus, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { passkeyLogin, isUnlinkedPasskeyError, isPasskeyRpMismatchError } from '@/lib/passkeys';
import { userAvatarCache } from '@/lib/useravatarcache';
import { useTheme } from '@/providers/themeprovider';
import Avatar from '@/components/avatar';
import GlassButton from '@/components/glass/glassbutton';
import GlassFooter from '@/components/glass/glassfooter';
import { useTap } from '@/lib/tap';
import { resolveNetwork } from '@glyphteck/shared/network';

const REMEMBERED_ROW_HEIGHT = 62;

function RememberedRow({ account, disabled, onPress, onForget }) {
    const { theme } = useTheme();
    const accountPress = useTap({ disabled, onPress, scale: 0.92 });
    const forgetPress = useTap({ disabled, onPress: onForget, scale: 0.88 });

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: REMEMBERED_ROW_HEIGHT, paddingHorizontal: 16, paddingVertical: 8 }}>
            <Pressable {...accountPress.props} disabled={disabled} style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 46 }}>
                    <RNAnimated.View style={{ transform: [{ scale: accountPress.scale }] }}>
                        <Avatar source={account.avatar ? { uri: account.avatar } : null} size={46} pointerEvents="none" />
                    </RNAnimated.View>
                    <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: theme.foreground, fontSize: 20, fontWeight: '900' }}>
                        {account.username ? `@${account.username}` : 'account'}
                    </Text>
                </View>
            </Pressable>
            <Pressable {...forgetPress.props} disabled={disabled} hitSlop={10} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <RNAnimated.View
                    style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        alignItems: 'center',
                        justifyContent: 'center',
                        transform: [{ scale: forgetPress.scale }],
                    }}
                >
                    <X pointerEvents="none" size={22} strokeWidth={3.2} color={theme.muted} />
                </RNAnimated.View>
            </Pressable>
        </View>
    );
}

export default function Login() {
    const { theme } = useTheme();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { height } = useWindowDimensions();
    const [authState, setAuthState] = useState('idle');
    const [feedback, setFeedback] = useState('');
    const [remembered, setRemembered] = useState([]);
    const feedbackTimerRef = useRef(null);
    const isBusy = authState !== 'idle';
    const network = resolveNetwork(globalThis?.process?.env ?? {});
    const isTestEnv = network !== 'MAINNET';
    const accounts = remembered;
    const maxCardHeight = Math.round(height * 0.25);
    const cardHeight = accounts.length ? Math.min(maxCardHeight, accounts.length * REMEMBERED_ROW_HEIGHT + 24) : 0;
    const actionBottom = accounts.length ? cardHeight + 18 : '14%';
    const warningTop = insets.top + 10;

    const clearFeedback = useCallback(() => {
        if (feedbackTimerRef.current) {
            clearTimeout(feedbackTimerRef.current);
            feedbackTimerRef.current = null;
        }
        setFeedback('');
    }, []);

    const showFeedback = useCallback(
        (message) => {
            clearFeedback();
            setFeedback(message);
            feedbackTimerRef.current = setTimeout(() => {
                feedbackTimerRef.current = null;
                setFeedback('');
            }, 3000);
        },
        [clearFeedback]
    );

    useEffect(() => {
        let cancelled = false;
        userAvatarCache
            .listRemembered?.()
            .then((accounts) => {
                if (!cancelled) {
                    setRemembered(accounts || []);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setRemembered([]);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        return () => {
            if (feedbackTimerRef.current) {
                clearTimeout(feedbackTimerRef.current);
            }
        };
    }, []);

    const handleLogin = async (uid = null) => {
        if (authState !== 'idle') return;

        clearFeedback();
        setAuthState('preparing');
        try {
            await passkeyLogin({
                uid,
                onPrompt: () => setAuthState('prompt'),
            });
            if (uid) {
                await userAvatarCache.touchLogin?.(uid);
            }
            setAuthState('success');
        } catch (err) {
            console.warn('passkey login failed', err);
            if (isUnlinkedPasskeyError(err)) {
                showFeedback('passkey not recognized');
                if (uid) {
                    await userAvatarCache.forget?.(uid);
                    setRemembered((current) => current.filter((account) => account.uid !== uid));
                }
            } else if (isPasskeyRpMismatchError(err)) {
                showFeedback('this passkey is from an older glyphteck setup');
            }
            setAuthState('idle');
        }
    };

    const handleForgetAccount = async (uid) => {
        if (authState !== 'idle' || !uid) return;
        setRemembered((current) => current.filter((account) => account.uid !== uid));
        try {
            await userAvatarCache.forget?.(uid);
        } catch (err) {
            console.warn('failed to forget remembered account', err);
        }
    };

    const handleNewAccount = () => {
        if (authState !== 'idle') return;
        router.push('/newaccount');
    };

    const loaderText = authState === 'preparing' ? 'preparing passkey…' : authState === 'success' ? 'signing in…' : 'waiting for passkey…';

    return (
        <View style={{ flex: 1 }}>
            <View style={{ position: 'absolute', top: '22%', left: 0, right: 0, alignItems: 'center' }}>
                <Image source={require('../assets/wallet.png')} style={{ width: 192, height: 192 }} contentFit="contain" />
                {isBusy ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <ActivityIndicator color={theme.muted || theme.foreground} />
                        <Text style={{ fontSize: 24, color: theme.muted, fontWeight: 'bold', marginLeft: 10 }}>{loaderText}</Text>
                    </View>
                ) : feedback ? (
                    <Text
                        style={{
                            marginTop: -8,
                            paddingHorizontal: 24,
                            fontSize: feedback ? 18 : 24,
                            fontStyle: feedback ? 'normal' : 'italic',
                            fontWeight: '900',
                            color: feedback ? theme.destructive : theme.active,
                            textAlign: 'center',
                        }}
                    >
                        {feedback}
                    </Text>
                ) : null}
            </View>
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: actionBottom, alignItems: 'center', gap: 12 }}>
                <GlassButton onPress={() => handleLogin()} icon={Fingerprint} label="login" accent disabled={isBusy} style={{ width: 256 }} />
                <GlassButton onPress={handleNewAccount} icon={UserRoundPlus} label="new account" disabled={isBusy} style={{ width: 256 }} />
            </View>
            {accounts.length ? (
                <GlassFooter style={{ height: cardHeight }} contentStyle={{ height: '100%', paddingTop: 0, paddingBottom: 0, paddingHorizontal: 0 }}>
                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        style={{ flex: 1 }}
                        contentContainerStyle={{
                            paddingTop: 8,
                            paddingBottom: 16,
                        }}
                    >
                        {accounts.map((account) => (
                            <RememberedRow key={account.uid} account={account} disabled={isBusy} onPress={() => handleLogin(account.uid)} onForget={() => handleForgetAccount(account.uid)} />
                        ))}
                    </ScrollView>
                </GlassFooter>
            ) : null}
            {isTestEnv ? (
                <View style={{ position: 'absolute', left: 24, right: 24, top: warningTop, alignItems: 'center' }}>
                    <Text style={{ color: theme.destructive, fontSize: 12, fontWeight: '900', textAlign: 'center', lineHeight: 18 }}>
                        YOU ARE CURRENTLY IN TEST ENVIRONMENT. DO NOT SEND REAL BITCOIN TO YOUR ACCOUNT.
                    </Text>
                </View>
            ) : null}
        </View>
    );
}
