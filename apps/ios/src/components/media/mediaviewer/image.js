import { ActivityIndicator, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/providers/themeprovider';

export function ImageSlide({ active, onReady, source }) {
    const { theme } = useTheme();
    const { uri, loading, error, setError } = source;

    if (uri && !error) {
        return (
            <Image
                source={{ uri }}
                style={{ width: '100%', height: '100%' }}
                contentFit="contain"
                enableLiveTextInteraction={false}
                onLoad={active ? onReady : undefined}
                onError={() => {
                    setError('image unavailable');
                    if (active) {
                        onReady?.();
                    }
                }}
            />
        );
    }

    return (
        <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            {loading ? <ActivityIndicator color={theme.foreground} /> : <Text style={{ color: theme.muted, fontSize: 14 }}>{error || 'image unavailable'}</Text>}
        </View>
    );
}
