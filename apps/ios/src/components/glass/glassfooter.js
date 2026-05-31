import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GlassView from './glassview';

export default function GlassFooter({ onLayout, pointerEvents, style, contentStyle, children }) {
    const insets = useSafeAreaInsets();

    return (
        <GlassView
            glassEffectStyle="clear"
            style={[{ position: 'absolute', bottom: 0, left: 0, right: 0, marginBottom: -4, marginHorizontal: -4, paddingBottom: 4, paddingHorizontal: 4 }, style]}
            onLayout={onLayout}
            pointerEvents={pointerEvents}
        >
            {children ? <View style={[{ paddingTop: 8, paddingBottom: insets.bottom, paddingHorizontal: 12 }, contentStyle]}>{children}</View> : null}
        </GlassView>
    );
}
