import GlassView from '@/components/glass/glassview';
import { useTheme } from '@/providers/themeprovider';

export default function GlassField({ children, disabled = false, tintColor, style }) {
    const { theme } = useTheme();

    return (
        <GlassView
            glassEffectStyle="regular"
            tintColor={tintColor ?? theme.background}
            style={[
                {
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderRadius: 24,
                    opacity: disabled ? 0.6 : 1,
                },
                style,
            ]}
        >
            {children}
        </GlassView>
    );
}
