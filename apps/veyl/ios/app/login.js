import { Animated as RNAnimated, Pressable, Text, ActivityIndicator, View } from 'react-native';
import { Image } from 'expo-image';
import { Fingerprint, UserRoundPlus, UsersRound, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { passkeyLogin, isUnlinkedPasskeyError, isPasskeyRpMismatchError } from '@/lib/passkeys';
import { forgetQuickLoginAccount, listQuickLoginAccounts, subscribeQuickLoginRequest, touchQuickLoginAccount } from '@/lib/quicklogin';
import { useTheme } from '@/providers/themeprovider';
import Avatar, { AvatarAdornment, getAvatarAdornmentMetrics } from '@/components/avatar';
import GlassButton from '@/components/glass/glassbutton';
import GlassIcon from '@/components/glass/glassicon';
import { walletLogoSource } from '@/lib/brand';
import { useTap } from '@/lib/tap';

const REMEMBERED_INLINE_LIMIT = 2;
const QUICK_AVATAR_SIZE = 72;
const QUICK_REMOVE_METRICS = getAvatarAdornmentMetrics(QUICK_AVATAR_SIZE, { type: 'action' });
const QUICK_REMOVE_MASKS = [QUICK_REMOVE_METRICS];

function truncateLabel(label, max = 8) {
    if (!label || label.length <= max) return label || '';
    return `${label.slice(0, max)}...`;
}

function QuickLoginCell({ account, disabled = false, onPress, onForget }) {
    const { theme } = useTheme();
    const press = useTap({ disabled, onPress, scale: 0.9, hapticIn: 'light' });
    const label = truncateLabel(account.username ? `@${account.username}` : 'account');

    return (
        <View style={{ width: QUICK_AVATAR_SIZE, alignItems: 'center' }}>
            <Pressable {...press.props} disabled={disabled} style={{ alignItems: 'center' }}>
                <RNAnimated.View style={{ alignItems: 'center', transform: [{ scale: press.scale }] }}>
                    <Avatar source={account.avatar ? { uri: account.avatar } : null} size={QUICK_AVATAR_SIZE} pointerEvents="none" maskAdornments={QUICK_REMOVE_MASKS} bot={!!account.bot} />
                    <Text numberOfLines={1} style={{ marginTop: 6, width: 86, textAlign: 'center', color: theme.foreground, fontSize: 14, fontWeight: '700' }}>
                        {label}
                    </Text>
                </RNAnimated.View>
            </Pressable>
            <AvatarAdornment metrics={QUICK_REMOVE_METRICS} icon={X} color={theme.foreground} iconColor={theme.background} onPress={onForget} disabled={disabled} style={{ zIndex: 2 }} />
        </View>
    );
}

export default function Login() {
    const { theme } = useTheme();
    const router = useRouter();
    const [authState, setAuthState] = useState('idle');
    const [feedback, setFeedback] = useState('');
    const [remembered, setRemembered] = useState([]);
    const feedbackTimerRef = useRef(null);
    const loadingCoverOpacity = useRef(new RNAnimated.Value(0)).current;
    const isBusy = authState !== 'idle';
    const accounts = remembered;
    const visibleAccounts = accounts.slice(0, REMEMBERED_INLINE_LIMIT);
    const hasMoreAccounts = accounts.length > REMEMBERED_INLINE_LIMIT;
    const quickLoginItemCount = visibleAccounts.length + (hasMoreAccounts ? 1 : 0);
    const quickLoginRowFull = quickLoginItemCount >= 3;

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
        listQuickLoginAccounts()
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

    useEffect(() => {
        RNAnimated.timing(loadingCoverOpacity, {
            toValue: isBusy ? 1 : 0,
            duration: 160,
            useNativeDriver: true,
        }).start();
    }, [isBusy, loadingCoverOpacity]);

    const handleLogin = useCallback(async (uid = null) => {
        if (authState !== 'idle') return;

        clearFeedback();
        setAuthState('preparing');
        try {
            await passkeyLogin({
                uid,
                onPrompt: () => setAuthState('prompt'),
            });
            if (uid) {
                await touchQuickLoginAccount(uid);
            }
            setAuthState('success');
        } catch (err) {
            console.warn('passkey login failed', err);
            if (isUnlinkedPasskeyError(err)) {
                showFeedback('passkey not recognized');
                if (uid) {
                    await forgetQuickLoginAccount(uid);
                    setRemembered((current) => current.filter((account) => account.uid !== uid));
                }
            } else if (isPasskeyRpMismatchError(err)) {
                showFeedback('this passkey is from an older glyphteck setup');
            }
            setAuthState('idle');
        }
    }, [authState, clearFeedback, showFeedback]);

    useEffect(() => {
        return subscribeQuickLoginRequest((uid) => {
            void handleLogin(uid);
        });
    }, [handleLogin]);

    const handleForgetAccount = async (uid) => {
        if (authState !== 'idle' || !uid) return;
        setRemembered((current) => current.filter((account) => account.uid !== uid));
        try {
            await forgetQuickLoginAccount(uid);
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
            <View style={{ position: 'absolute', top: '22%', left: 0, right: 0, alignItems: 'center', zIndex: 50 }}>
                <Image source={walletLogoSource} style={{ width: 192, height: 192 }} contentFit="contain" />
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
            <RNAnimated.View
                pointerEvents={isBusy ? 'auto' : 'none'}
                style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                    zIndex: 40,
                    backgroundColor: theme.background,
                    opacity: loadingCoverOpacity,
                }}
            />
            <RNAnimated.View
                pointerEvents={isBusy ? 'none' : 'auto'}
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: '14%',
                    alignItems: 'center',
                    gap: 12,
                }}
            >
                {accounts.length ? (
                    <View
                        style={{
                            width: 256,
                            flexDirection: 'row',
                            alignItems: 'flex-start',
                            justifyContent: quickLoginRowFull ? 'space-between' : 'center',
                            gap: quickLoginRowFull ? 0 : 22,
                            marginBottom: 2,
                        }}
                    >
                        {visibleAccounts.map((account) => (
                            <QuickLoginCell key={account.uid} account={account} onPress={() => handleLogin(account.uid)} onForget={() => handleForgetAccount(account.uid)} />
                        ))}
                        {hasMoreAccounts ? <GlassIcon icon={UsersRound} size={72} iconSize={34} onPress={() => router.push('/quicklogin')} /> : null}
                    </View>
                ) : null}
                <View style={{ alignItems: 'center', gap: 12 }}>
                    <GlassButton onPress={() => handleLogin()} icon={Fingerprint} label="login" accent style={{ width: 256 }} />
                    <GlassButton onPress={handleNewAccount} icon={UserRoundPlus} label="new account" style={{ width: 256 }} />
                </View>
            </RNAnimated.View>
        </View>
    );
}
