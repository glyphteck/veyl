import GlassView from '@/components/glass/glassview';
import { useTheme } from '@/providers/themeprovider';

export default function GlassField({ children, disabled = false, tintColor, style }) {
    const { theme } = useTheme();

    return (
        <GlassView
            glassEffectStyle="regular"
            tintColor={tintColor ?? theme.glassBackgroundSoft}
            style={[
                {
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderRadius: 24,
                },
                style,
            ]}
        >
            {children}
        </GlassView>
    );
}
