import { ActivityIndicator, Text, View } from 'react-native';

import Icon from '@/components/icon';
import { useTheme } from '@/providers/themeprovider';

export default function EmptyState({ icon, title, detail, busy = false, style }) {
    const { theme } = useTheme();
    const showDetail = !!detail;

    return (
        <View
            style={[
                {
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 28,
                    paddingVertical: 24,
                },
                style,
            ]}
        >
            {busy ? <ActivityIndicator size="small" color={theme.muted} /> : icon ? <Icon icon={icon} size={28} color={theme.muted} /> : null}
            {!!title && (
                <Text
                    style={{
                        marginTop: busy || icon ? 14 : 0,
                        textAlign: 'center',
                        fontSize: showDetail ? 24 : 16,
                        fontWeight: showDetail ? '900' : '700',
                        color: showDetail ? theme.foreground : theme.muted,
                    }}
                >
                    {title}
                </Text>
            )}
            {!!detail && (
                <Text
                    style={{
                        marginTop: 8,
                        textAlign: 'center',
                        fontSize: 16,
                        lineHeight: 22,
                        fontWeight: '700',
                        color: theme.muted,
                    }}
                >
                    {detail}
                </Text>
            )}
        </View>
    );
}
