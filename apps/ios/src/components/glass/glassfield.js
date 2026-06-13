import GlassView from '@/components/glass/glassview';
import { inputGlassTint } from '@/lib/colors';
import { useTheme } from '@/providers/themeprovider';

export default function GlassField({ children, disabled = false, tintColor, style }) {
    const { theme } = useTheme();

    return (
        <GlassView
            glassEffectStyle="regular"
            tintColor={tintColor ?? inputGlassTint(theme)}
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
