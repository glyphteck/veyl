import { Alert, Animated as RNAnimated, Pressable } from 'react-native';
import { useTap } from '@/lib/tap';

const HOLD_MS = 220;

export default function MediaAction({ onLongPress, delayLongPress = HOLD_MS, longScale = 0.9, spring, children }) {
    const press = useTap({
        onLongPress: () => {
            Promise.resolve(onLongPress?.()).catch((error) => {
                console.warn('media action failed', error);
                Alert.alert('Action failed', error?.message || 'Could not complete that action.');
            });
        },
        scale: 1,
        longScale,
        activeScale: longScale,
        hapticIn: false,
        hapticOut: false,
        hapticPress: false,
        hapticLongPress: 'medium',
        delayLongPress,
        releaseLongPressOnPressOut: true,
        spring,
    });

    return (
        <Pressable {...press.props}>
            <RNAnimated.View style={{ transform: [{ scale: press.scale }] }}>{children}</RNAnimated.View>
        </Pressable>
    );
}
