import { View } from 'react-native';
import { useTheme } from '@/providers/themeprovider';

export const REACTION_MARK_W = 33;
export const REACTION_MARK_H = 27;
export const REACTION_MARK_INSET = 20;
export const REACTION_MARK_BOTTOM = -18;
export const REACTION_CUTOUT = 4;
export const REACTION_SPACE = 14;

export default function ReactionTray({ children, reaction, active = false, style }) {
    const { theme } = useTheme();
    const cutoutSize = {
        width: REACTION_MARK_W + REACTION_CUTOUT * 2,
        height: REACTION_MARK_H + REACTION_CUTOUT * 2,
    };

    return (
        <View style={[{ position: 'relative', maxWidth: '100%', paddingBottom: active ? REACTION_SPACE : 0 }, style]}>
            {children}
            {active ? (
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        left: REACTION_MARK_INSET - REACTION_MARK_W / 2 - REACTION_CUTOUT,
                        bottom: REACTION_MARK_BOTTOM + REACTION_SPACE - REACTION_CUTOUT,
                        ...cutoutSize,
                        borderRadius: cutoutSize.height / 2,
                        backgroundColor: theme.background,
                        zIndex: 9,
                    }}
                />
            ) : null}
            {reaction}
        </View>
    );
}
