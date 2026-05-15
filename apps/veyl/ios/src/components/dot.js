import { useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Mask, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/providers/themeprovider';

export const DOT_ICONS = {
    messageCircle: [['path', { d: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719' }]],
    wallet: [
        ['path', { d: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1' }],
        ['path', { d: 'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4' }],
    ],
};

export function getDotMetrics(size, { compact = false } = {}) {
    const boost = compact ? 5 / Math.max(1, Math.sqrt(size / 24)) : 0;
    const dotSize = compact ? Math.round(size / 3 + boost) : Math.max(12, Math.round(size / 3));
    const inset = compact ? Math.max(dotSize * 0.12, boost * 0.35) : dotSize / 6;
    const innerSize = dotSize - inset * 2;
    const center = size * 0.85355;

    return {
        center,
        dotSize,
        innerSize,
        left: center - dotSize / 2,
        top: center - dotSize / 2,
    };
}

function getMaskId(id) {
    return `dot-mask-${id.replace(/[^a-zA-Z0-9_-]/g, '') || 'id'}`;
}

function getDotColor(theme, type) {
    return type === 'active' ? theme.active : theme.alert ?? theme.destructive;
}

function IconShape({ item }) {
    const [tag, attrs] = item;

    if (tag === 'rect') {
        return <Rect {...attrs} />;
    }

    if (tag === 'circle') {
        return <Circle {...attrs} />;
    }

    return <Path {...attrs} />;
}

export function DotBadge({ show = false, type = 'alert', size, compact = false, style }) {
    const { theme } = useTheme();
    const metrics = useMemo(() => getDotMetrics(size, { compact }), [compact, size]);
    const styles = useMemo(
        () =>
            StyleSheet.create({
                outer: {
                    position: 'absolute',
                    width: metrics.dotSize,
                    height: metrics.dotSize,
                    borderRadius: metrics.dotSize / 2,
                    left: metrics.left,
                    top: metrics.top,
                    justifyContent: 'center',
                    alignItems: 'center',
                },
                inner: {
                    width: metrics.innerSize,
                    height: metrics.innerSize,
                    borderRadius: metrics.innerSize / 2,
                    backgroundColor: getDotColor(theme, type),
                },
            }),
        [metrics.dotSize, metrics.innerSize, metrics.left, metrics.top, theme, type]
    );

    if (!show) {
        return null;
    }

    return (
        <View pointerEvents="none" style={[styles.outer, style]}>
            <View style={styles.inner} />
        </View>
    );
}

export function DotIcon({ iconNode, show = false, type = 'alert', size = 24, color, strokeWidth = 2.8, style }) {
    const { theme } = useTheme();
    const id = useId();
    const maskId = useMemo(() => getMaskId(id), [id]);
    const metrics = useMemo(() => getDotMetrics(size, { compact: true }), [size]);
    const maskScale = 24 / size;

    return (
        <View pointerEvents="none" style={[{ width: size, height: size }, style]}>
            <Svg width={size} height={size} viewBox="0 0 24 24" pointerEvents="none">
                {show ? (
                    <Defs>
                        <Mask id={maskId} x="0" y="0" width="24" height="24" maskUnits="userSpaceOnUse">
                            <Rect x="0" y="0" width="24" height="24" fill="white" />
                            <Circle cx={metrics.center * maskScale} cy={metrics.center * maskScale} r={(metrics.dotSize / 2) * maskScale} fill="black" />
                        </Mask>
                    </Defs>
                ) : null}
                <G mask={show ? `url(#${maskId})` : undefined} fill="none" stroke={color ?? theme.foreground} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
                    {iconNode?.map((item, index) => (
                        <IconShape key={`${item[0]}-${index}`} item={item} />
                    ))}
                </G>
            </Svg>
            <DotBadge show={show} type={type} size={size} compact />
        </View>
    );
}
