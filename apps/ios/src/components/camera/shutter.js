import { Animated as RNAnimated, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Reanimated from 'react-native-reanimated';
import Avatar from '@/components/avatar';
import GlassView from '@/components/glass/glassview';
import { MENU_LONG_PRESS_MS } from '@/components/menu';
import { Lock } from 'lucide-react-native';
import { alpha } from '@/lib/colors';

export const SHUTTER_SIZE = 82;

const SHUTTER_LOCK_RETENTION = { top: 28, bottom: 28, left: 86, right: 86 };

export function CameraShutter({ disabled, isDark, lockGesture, onLongPress, onPress, onPressIn, onPressOut, onTouchCancel, onTouchMove, previewPeer, previewStyle, recording, recordingLocked, scale, theme }) {
    const tint = recording ? alpha(theme.destructive, 72) : previewPeer ? 'transparent' : isDark ? 'rgba(0,0,0,0.20)' : 'rgba(255,255,255,0.20)';
    const frame = {
        width: SHUTTER_SIZE,
        height: SHUTTER_SIZE,
        borderRadius: SHUTTER_SIZE / 2,
        overflow: 'hidden',
    };
    const pressable = (
        <Pressable
            disabled={disabled}
            delayLongPress={MENU_LONG_PRESS_MS}
            pressRetentionOffset={SHUTTER_LOCK_RETENTION}
            onPress={onPress}
            onLongPress={onLongPress}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            onTouchCancel={onTouchCancel}
            onTouchMove={onTouchMove}
        >
            <RNAnimated.View
                style={{
                    ...frame,
                    transform: [{ scale }],
                }}
            >
                <View style={[StyleSheet.absoluteFill, frame]} pointerEvents="none">
                    {previewPeer ? (
                        <Reanimated.View style={[StyleSheet.absoluteFill, previewStyle]}>
                            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                                <Avatar source={previewPeer.avatar ? { uri: previewPeer.avatar } : null} size={SHUTTER_SIZE} pointerEvents="none" />
                            </View>
                        </Reanimated.View>
                    ) : null}
                    <GlassView style={[StyleSheet.absoluteFill, frame]} glassEffectStyle="clear" tintColor={tint} isInteractive />
                    {recordingLocked ? (
                        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                            <Lock pointerEvents="none" color={theme.foreground} size={24} strokeWidth={3} />
                        </View>
                    ) : null}
                </View>
            </RNAnimated.View>
        </Pressable>
    );

    return (
        <View style={{ width: SHUTTER_SIZE, height: SHUTTER_SIZE, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
            {recordingLocked || !lockGesture ? pressable : <GestureDetector gesture={lockGesture}>{pressable}</GestureDetector>}
        </View>
    );
}
