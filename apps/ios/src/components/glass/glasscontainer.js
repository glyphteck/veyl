import { View } from 'react-native';
import { GlassContainer as NativeGlassContainer } from 'expo-glass-effect';

import { useUser } from '@/providers/userprovider';

export default function GlassContainer({ spacing, style, children, ...props }) {
    const { settings } = useUser();

    if (settings?.glass !== false) {
        return (
            <NativeGlassContainer spacing={spacing} style={style} {...props}>
                {children}
            </NativeGlassContainer>
        );
    }

    return (
        <View style={style} {...props}>
            {children}
        </View>
    );
}
