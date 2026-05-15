import { useEffect, useId, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Image as SvgImage, Mask, Path, Rect } from 'react-native-svg';
import { DotBadge, getDotMetrics } from './dot';
import { useTheme } from '../providers/themeprovider';

const AVATAR_ANIMATION_MS = 160;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const loadedSourceKeys = new Set();

export function getAvatarSourceKey(source) {
    if (!source) return '';
    if (typeof source === 'number') return String(source);
    if (typeof source === 'string') return source;
    return source.uri || '';
}

export function isAvatarSourceLoaded(source) {
    const sourceKey = getAvatarSourceKey(source);
    return !!sourceKey && loadedSourceKeys.has(sourceKey);
}

function AvatarGlyph({ bot, size, color }) {
    const glyphSize = bot ? size * 0.7 : size * 1.1;
    const x = (size - glyphSize) / 2;
    const y = bot ? x : (size - glyphSize - size * 0.25) / 2 + size * 0.25;
    const scale = glyphSize / 24;

    return (
        <G transform={`translate(${x} ${y}) scale(${scale})`} fill="none" stroke={color} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round">
            {bot ? (
                <>
                    <Path d="M12 8V4H8" />
                    <Rect width="16" height="12" x="4" y="8" rx="2" />
                    <Path d="M2 14h2" />
                    <Path d="M20 14h2" />
                    <Path d="M15 13v2" />
                    <Path d="M9 13v2" />
                </>
            ) : (
                <>
                    <Circle cx="12" cy="8" r="5" />
                    <Path d="M20 21a8 8 0 0 0-16 0" />
                </>
            )}
        </G>
    );
}

function getMaskId(id) {
    return `avatar-mask-${id.replace(/[^a-zA-Z0-9_-]/g, '') || 'id'}`;
}

export default function Avatar({ source, size = 52, style, pointerEvents, active = false, selected = null, bot = false, hideFallbackUntilLoaded = false, assumeImageLoaded = false, onImageLoad }) {
    const { theme } = useTheme();
    const id = useId();
    const sourceKey = getAvatarSourceKey(source);
    const [loadedKey, setLoadedKey] = useState(() => (sourceKey && loadedSourceKeys.has(sourceKey) ? sourceKey : ''));
    const imageLoaded = !!sourceKey && (assumeImageLoaded || loadedKey === sourceKey);
    const maskId = useMemo(() => getMaskId(id), [id]);
    const dot = useMemo(() => getDotMetrics(size), [size]);
    const selectable = selected != null;
    const selectedStroke = 3;
    const selectedRadius = size / 2 - selectedStroke / 2;
    const selectedProgress = useSharedValue(selected ? 1 : 0);
    const selectedProps = useAnimatedProps(() => ({
        opacity: selectedProgress.value,
    }));

    useEffect(() => {
        if (!sourceKey) {
            setLoadedKey('');
            return;
        }
        if (loadedSourceKeys.has(sourceKey)) {
            setLoadedKey(sourceKey);
            onImageLoad?.(sourceKey);
        }
    }, [onImageLoad, sourceKey]);

    useEffect(() => {
        selectedProgress.value = withTiming(selected ? 1 : 0, { duration: AVATAR_ANIMATION_MS });
    }, [selected, selectedProgress]);

    const styles = useMemo(
        () =>
            StyleSheet.create({
                shadow: {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: 'transparent',
                    shadowColor: theme.shadow,
                    shadowOpacity: 1,
                    shadowRadius: 3,
                    shadowOffset: { width: 0, height: 0 },
                },
            }),
        [size, theme.shadow]
    );

    return (
        <View style={[styles.shadow, style]} pointerEvents={pointerEvents}>
            <Svg width={size} height={size} pointerEvents={pointerEvents}>
                <Defs>
                    <Mask id={maskId} x="0" y="0" width={size} height={size} maskUnits="userSpaceOnUse">
                        <Rect x="0" y="0" width={size} height={size} fill="black" />
                        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="white" />
                        {active ? <Circle cx={dot.center} cy={dot.center} r={dot.dotSize / 2} fill="black" /> : null}
                    </Mask>
                </Defs>
                <G mask={`url(#${maskId})`}>
                    <Rect x="0" y="0" width={size} height={size} fill={theme.background} />
                    {!hideFallbackUntilLoaded || !sourceKey || imageLoaded ? <AvatarGlyph bot={bot} size={size} color={theme.foreground} /> : null}
                    {source ? (
                        <SvgImage
                            href={source}
                            x="0"
                            y="0"
                            width={size}
                            height={size}
                            preserveAspectRatio="xMidYMid slice"
                            opacity={imageLoaded ? 1 : 0}
                            onLoad={() => {
                                if (sourceKey) {
                                    loadedSourceKeys.add(sourceKey);
                                    setLoadedKey(sourceKey);
                                    onImageLoad?.(sourceKey);
                                }
                            }}
                        />
                    ) : null}
                    {selectable ? <AnimatedCircle animatedProps={selectedProps} cx={size / 2} cy={size / 2} r={selectedRadius} fill="none" stroke={theme.active} strokeWidth={selectedStroke} /> : null}
                </G>
            </Svg>
            <DotBadge show={active} type="active" size={size} />
        </View>
    );
}
