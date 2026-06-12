import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/providers/themeprovider';
import FloatingHeader, { FloatingHeaderBackIcon } from '@/components/floatingheader';
import GlassButton from '@/components/glass/glassbutton';
import GlassField from '@/components/glass/glassfield';
import { passkeyRegister } from '@/lib/passkeys';
import { useTap } from '@/lib/tap';
import Avatar from '@/components/avatar';
import { sleep } from '@veyl/shared/utils/async';

const PASSKEY_AVATAR_SIZE = 72;
const PASSKEY_AVATAR_GLYPH_SCALE = 1.12;
const PASSKEY_AVATAR_PULSE_MS = 800;
const PASSKEY_AVATAR_SUCCESS_MS = 500;

export default function NewAccount() {
    const { theme } = useTheme();
    const router = useRouter();
    const registeringRef = useRef(false);
    const [accountName, setAccountName] = useState('');
    const [authState, setAuthState] = useState('idle');
    const promptCoverOpacity = useRef(new Animated.Value(0)).current;
    const waitingAvatarOpacity = useRef(new Animated.Value(1)).current;
    const successAvatarOpacity = useRef(new Animated.Value(0)).current;
    const isLoading = authState !== 'idle';
    const isWaitingForAuth = isLoading && authState !== 'success';
    const isCovering = isLoading;

    useEffect(() => {
        Animated.timing(promptCoverOpacity, {
            toValue: isCovering ? 1 : 0,
            duration: 160,
            useNativeDriver: true,
        }).start();
    }, [isCovering, promptCoverOpacity]);

    useEffect(() => {
        if (!isWaitingForAuth) {
            return;
        }

        successAvatarOpacity.setValue(0);
        waitingAvatarOpacity.setValue(1);
        const pulse = Animated.loop(
            Animated.sequence([
                Animated.timing(waitingAvatarOpacity, {
                    toValue: 0.35,
                    duration: PASSKEY_AVATAR_PULSE_MS,
                    useNativeDriver: true,
                }),
                Animated.timing(waitingAvatarOpacity, {
                    toValue: 1,
                    duration: PASSKEY_AVATAR_PULSE_MS,
                    useNativeDriver: true,
                }),
            ])
        );
        pulse.start();
        return () => pulse.stop();
    }, [isWaitingForAuth, successAvatarOpacity, waitingAvatarOpacity]);

    useEffect(() => {
        if (authState === 'success') {
            Animated.parallel([
                Animated.timing(waitingAvatarOpacity, {
                    toValue: 0,
                    duration: PASSKEY_AVATAR_SUCCESS_MS,
                    useNativeDriver: true,
                }),
                Animated.timing(successAvatarOpacity, {
                    toValue: 1,
                    duration: PASSKEY_AVATAR_SUCCESS_MS,
                    useNativeDriver: true,
                }),
            ]).start();
            return;
        }

        successAvatarOpacity.setValue(0);
        if (authState === 'idle') {
            waitingAvatarOpacity.setValue(1);
        }
    }, [authState, successAvatarOpacity, waitingAvatarOpacity]);

    async function register(label) {
        if (registeringRef.current) return;
        registeringRef.current = true;
        const registration = passkeyRegister({
            label,
            onPrompt: () => setAuthState('prompt'),
            onVerified: async () => {
                setAuthState('success');
                await sleep(PASSKEY_AVATAR_SUCCESS_MS);
            },
        });
        try {
            setAuthState('preparing');
            await registration;
        } catch (err) {
            registeringRef.current = false;
            console.warn('passkey register failed', err);
            setAuthState('idle');
        }
    }

    const skipFeedback = useTap({
        disabled: isLoading,
        onPress: () => register(undefined),
    });

    return (
        <View style={{ flex: 1 }}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <View style={{ width: '100%', maxWidth: 360, gap: 12 }}>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: theme.foreground, paddingLeft: 4 }}>name your account</Text>
                    <GlassField disabled={isLoading} style={{ paddingHorizontal: 14 }}>
                        <TextInput
                            value={accountName}
                            onChangeText={setAccountName}
                            placeholder="account name"
                            placeholderTextColor={theme.muted}
                            autoCorrect={false}
                            autoCapitalize="none"
                            spellCheck={false}
                            editable={!isLoading}
                            returnKeyType="go"
                            onSubmitEditing={() => {
                                if (accountName.trim()) register(accountName.trim());
                            }}
                            style={{ flex: 1, fontSize: 20, color: theme.foreground, paddingVertical: 10 }}
                        />
                    </GlassField>
                    <GlassButton
                        onPress={() => register(accountName.trim())}
                        label={isLoading ? 'preparing passkey…' : 'create account'}
                        accent
                        disabled={isLoading || !accountName.trim()}
                        style={{ width: '100%', marginTop: 8 }}
                        pressableStyle={{ alignSelf: 'stretch' }}
                    />
                    <Pressable {...skipFeedback.props} disabled={isLoading} style={{ alignItems: 'center', marginTop: 4 }}>
                        <Animated.View style={{ opacity: isLoading ? 0.4 : 1, transform: [{ scale: skipFeedback.scale }] }}>
                            <Text style={{ color: theme.muted, fontSize: 16, fontWeight: '600' }}>{"i don't care"}</Text>
                        </Animated.View>
                    </Pressable>
                </View>
            </View>
            <FloatingHeader>
                <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                    <FloatingHeaderBackIcon onPress={() => router.back()} />
                </View>
                <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text numberOfLines={1} style={{ fontSize: 20, fontWeight: '800', color: theme.foreground }}>new account</Text>
                </View>
                <View style={{ width: 56 }} />
            </FloatingHeader>
            <Animated.View
                pointerEvents={isCovering ? 'auto' : 'none'}
                style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                    zIndex: 50,
                    backgroundColor: theme.background,
                    opacity: promptCoverOpacity,
                }}
            >
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: PASSKEY_AVATAR_SIZE, height: PASSKEY_AVATAR_SIZE }}>
                        <Animated.View style={{ position: 'absolute', opacity: waitingAvatarOpacity }}>
                            <Avatar size={PASSKEY_AVATAR_SIZE} source={null} pointerEvents="none" glyphScale={PASSKEY_AVATAR_GLYPH_SCALE} />
                        </Animated.View>
                        <Animated.View style={{ position: 'absolute', opacity: successAvatarOpacity }}>
                            <Avatar size={PASSKEY_AVATAR_SIZE} source={null} pointerEvents="none" glyphColor={theme.active} glyphScale={PASSKEY_AVATAR_GLYPH_SCALE} />
                        </Animated.View>
                    </View>
                </View>
            </Animated.View>
        </View>
    );
}
