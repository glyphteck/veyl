import { useTheme } from '@/providers/themeprovider';

export default function Icon({ icon: IconComponent, pointerEvents = 'none', size = 24, strokeWidth = 2.8, color, ...props }) {
    const { theme } = useTheme();
    if (!IconComponent) return null;
    return <IconComponent pointerEvents={pointerEvents} size={size} strokeWidth={strokeWidth} color={color ?? theme.foreground} {...props} />;
}
