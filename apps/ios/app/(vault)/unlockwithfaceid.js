import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Lock, Unlock } from 'lucide-react-native';

import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import Icon from '@/components/icon';
import { getFaceIdPassword } from '@/lib/faceid';
import { mark } from '@/lib/diagnostics';

let faceIdPromptInFlight = false;

export default function FaceIdUnlockScreen() {
    const { theme } = useTheme();
    const { unlockWithPsw, lockState, vault, setFaceIdFailed } = useVault();
    const user = useUser();

    const [appActive, setAppActive] = useState(AppState.currentState === 'active');
    const attemptedRef = useRef(false);
    const lockOpacity = useRef(new Animated.Value(1)).current;
    const lockIconOpacity = useRef(new Animated.Value(1)).current;
    const unlockIconOpacity = useRef(new Animated.Value(0)).current;

    const vaultReady = !!vault;

    const attemptFaceId = useCallback(async () => {
        if (!vaultReady) {
            mark('faceid.unlock.skip', { reason: 'seed-not-ready', lockState });
            return;
        }
        if (lockState !== 'locked') {
            mark('faceid.unlock.skip', { reason: 'vault-busy', lockState });
            return;
        }
        if (AppState.currentState !== 'active') {
            mark('faceid.unlock.skip', { reason: 'app-inactive', lockState });
            return;
        }
        if (faceIdPromptInFlight) {
            mark('faceid.unlock.skip', { reason: 'prompt-in-flight', lockState });
            return;
        }
        faceIdPromptInFlight = true;
        const startedAt = Date.now();
        mark('faceid.unlock.start', { lockState });
        try {
            const passwordStartedAt = Date.now();
            mark('faceid.password.start', {});
            const password = await getFaceIdPassword(user?.uid);
            mark('faceid.password.done', { elapsedMs: Date.now() - passwordStartedAt, found: !!password });
            if (!password) {
                mark('faceid.unlock.done', { elapsedMs: Date.now() - startedAt, reason: 'missing-password' });
                setFaceIdFailed(true);
                return;
            }
            await unlockWithPsw(password, {
                source: 'faceid',
                stageFaceId: false,
                onSeedDecrypted: () =>
                    new Promise((resolve) => {
                        Animated.parallel([
                            Animated.timing(lockIconOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
                            Animated.timing(unlockIconOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
                        ]).start(resolve);
                    }),
            });
            mark('faceid.unlock.done', { elapsedMs: Date.now() - startedAt });
        } catch (error) {
            mark('faceid.unlock.error', { elapsedMs: Date.now() - startedAt, code: error?.code || '', message: error?.message || String(error) });
            setFaceIdFailed(true);
        } finally {
            faceIdPromptInFlight = false;
        }
    }, [lockState, vaultReady, setFaceIdFailed, unlockWithPsw, user?.uid, lockIconOpacity, unlockIconOpacity]);

    useEffect(() => {
        const sub = AppState.addEventListener('change', (nextState) => {
            setAppActive(nextState === 'active');
        });
        return () => sub?.remove?.();
    }, []);

    useEffect(() => {
        if (attemptedRef.current) return;
        if (!vaultReady) return;
        if (!appActive) return;
        attemptedRef.current = true;
        attemptFaceId();
    }, [appActive, attemptFaceId, vaultReady]);

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['top', 'left', 'right', 'bottom']}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Animated.View style={{ opacity: lockOpacity }}>
                    <View style={{ width: 64, height: 64 }}>
                        <Animated.View style={{ position: 'absolute', opacity: lockIconOpacity }}>
                            <Icon icon={Lock} size={64} color={theme.foreground} />
                        </Animated.View>
                        <Animated.View style={{ position: 'absolute', opacity: unlockIconOpacity }}>
                            <Icon icon={Unlock} size={64} color={theme.active} />
                        </Animated.View>
                    </View>
                </Animated.View>
            </View>
        </SafeAreaView>
    );
}
