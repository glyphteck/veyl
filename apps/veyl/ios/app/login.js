import { View, Text, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Fingerprint, UserRoundPlus } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { passkeyLogin, isUnlinkedPasskeyError, isPasskeyRpMismatchError } from '@/lib/passkeys';
import { useTheme } from '@/providers/themeprovider';
import GlassButton from '@/components/glass/glassbutton';
import { resolveNetwork } from '@glyphteck/shared/network';

export default function Login() {
    const { theme } = useTheme();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [authState, setAuthState] = useState('idle');
    const [feedback, setFeedback] = useState('');
    const feedbackTimerRef = useRef(null);
    const isBusy = authState !== 'idle';
    const network = resolveNetwork(globalThis?.process?.env ?? {});
    const isTestEnv = network !== 'MAINNET';

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
        return () => {
            if (feedbackTimerRef.current) {
                clearTimeout(feedbackTimerRef.current);
            }
        };
    }, []);

    const handleLogin = async () => {
        if (authState !== 'idle') return;

        clearFeedback();
        setAuthState('preparing');
        try {
            await passkeyLogin({
                onPrompt: () => setAuthState('prompt'),
            });
            setAuthState('success');
        } catch (err) {
            console.warn('passkey login failed', err);
            if (isUnlinkedPasskeyError(err)) {
                showFeedback('this passkey is not linked to an account');
            } else if (isPasskeyRpMismatchError(err)) {
                showFeedback('this passkey is from an older glyphteck setup');
            }
            setAuthState('idle');
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
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: '14%', alignItems: 'center', gap: 12 }}>
                <GlassButton onPress={handleLogin} icon={Fingerprint} label="login" accent disabled={isBusy} style={{ width: 256 }} />
                <GlassButton onPress={handleNewAccount} icon={UserRoundPlus} label="new account" disabled={isBusy} style={{ width: 256 }} />
            </View>
            {isTestEnv ? (
                <View style={{ position: 'absolute', left: 24, right: 24, bottom: insets.bottom + 18, alignItems: 'center' }}>
                    <Text style={{ color: theme.destructive, fontSize: 12, fontWeight: '900', textAlign: 'center', lineHeight: 18 }}>
                        YOU ARE CURRENTLY IN TEST ENVIRONMENT. DO NOT SEND REAL BITCOIN TO YOUR ACCOUNT.
                    </Text>
                </View>
            ) : null}
        </View>
    );
}
