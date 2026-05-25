export function resolveGlassEffectStyle(glassEffectStyle, visible = true, duration = 160) {
    const baseStyle = typeof glassEffectStyle === 'string' ? glassEffectStyle : glassEffectStyle?.style || 'clear';
    const animate = typeof glassEffectStyle === 'object' ? (glassEffectStyle?.animate ?? true) : true;
    const animationDuration = typeof glassEffectStyle === 'object' ? (glassEffectStyle?.animationDuration ?? duration / 1000) : duration / 1000;

    return {
        style: visible ? baseStyle : 'none',
        animate,
        animationDuration,
    };
}
