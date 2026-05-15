import { useCallback, useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Lock, Unlock } from 'lucide-react-native';

import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import Icon from '@/components/icon';
import { getFaceIdPassword } from '@/lib/faceid';

let faceIdPromptInFlight = false;

export default function FaceIdUnlockScreen() {
    const { theme } = useTheme();
    const { unlockWithPsw, lockState, encSeed, setFaceIdFailed } = useVault();
    const user = useUser();

    const attemptedRef = useRef(false);
    const lockOpacity = useRef(new Animated.Value(1)).current;
    const lockIconOpacity = useRef(new Animated.Value(1)).current;
    const unlockIconOpacity = useRef(new Animated.Value(0)).current;

    const seedReady = !!encSeed;

    const attemptFaceId = useCallback(async () => {
        if (!seedReady) return;
        if (lockState !== 'locked') return;
        if (faceIdPromptInFlight) return;
        faceIdPromptInFlight = true;
        try {
            const password = await getFaceIdPassword(user?.uid);
            if (!password) {
                setFaceIdFailed(true);
                return;
            }
            await unlockWithPsw(password, {
                stageFaceId: false,
                onSeedDecrypted: () =>
                    new Promise((resolve) => {
                        Animated.parallel([
                            Animated.timing(lockIconOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
                            Animated.timing(unlockIconOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
                        ]).start(resolve);
                    }),
            });
        } catch {
            setFaceIdFailed(true);
        } finally {
            faceIdPromptInFlight = false;
        }
    }, [lockState, seedReady, setFaceIdFailed, unlockWithPsw, user?.uid, lockIconOpacity, unlockIconOpacity]);

    useEffect(() => {
        if (attemptedRef.current) return;
        if (!seedReady) return;
        attemptedRef.current = true;
        attemptFaceId();
    }, [attemptFaceId, seedReady]);

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
