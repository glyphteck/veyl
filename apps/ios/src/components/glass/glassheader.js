import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GlassView from './glassview';

export default function GlassHeader({ onLayout, pointerEvents, style, contentStyle, children }) {
    const insets = useSafeAreaInsets();

    return (
        <GlassView
            glassEffectStyle="clear"
            style={[{ position: 'absolute', top: 0, left: 0, right: 0, marginTop: -4, marginHorizontal: -4, paddingTop: 4, paddingHorizontal: 4 }, style]}
            onLayout={onLayout}
            pointerEvents={pointerEvents}
        >
            {children ? <View style={[{ paddingTop: insets.top, paddingBottom: 8, paddingHorizontal: 12 }, contentStyle]}>{children}</View> : null}
        </GlassView>
    );
}
