import { memo, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
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

function useAvatarImageSource(source) {
    const sourceKey = getAvatarSourceKey(source);
    const sourceNumber = typeof source === 'number' ? source : null;
    const imageSource = useMemo(() => {
        if (!sourceKey) return null;
        return sourceNumber == null ? { uri: sourceKey } : sourceNumber;
    }, [sourceKey, sourceNumber]);

    return { sourceKey, imageSource };
}

export function StaticAvatar({ source, size = 52, style, pointerEvents, contentFit = 'cover', bot = false }) {
    const { theme } = useTheme();
    const { sourceKey, imageSource } = useAvatarImageSource(source);
    const [loadedKey, setLoadedKey] = useState(() => (sourceKey && loadedSourceKeys.has(sourceKey) ? sourceKey : ''));
    const imageLoaded = !!sourceKey && loadedKey === sourceKey;

    useEffect(() => {
        if (!sourceKey) {
            setLoadedKey('');
            return;
        }
        if (loadedSourceKeys.has(sourceKey)) {
            setLoadedKey(sourceKey);
            return;
        }
        setLoadedKey('');
    }, [sourceKey]);

    if (!sourceKey) {
        return (
            <View pointerEvents={pointerEvents} style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: theme.background }, style]}>
                <Svg width={size} height={size} pointerEvents={pointerEvents}>
                    <Rect x="0" y="0" width={size} height={size} fill={theme.background} />
                    <AvatarGlyph bot={bot} size={size} color={theme.foreground} />
                </Svg>
            </View>
        );
    }

    return (
        <View pointerEvents={pointerEvents} style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: theme.background }, style]}>
            {!imageLoaded ? (
                <Svg width={size} height={size} pointerEvents={pointerEvents}>
                    <Rect x="0" y="0" width={size} height={size} fill={theme.background} />
                    <AvatarGlyph bot={bot} size={size} color={theme.foreground} />
                </Svg>
            ) : null}
            <ExpoImage
                pointerEvents={pointerEvents}
                source={imageSource}
                recyclingKey={sourceKey}
                cachePolicy="memory-disk"
                transition={0}
                contentFit={contentFit}
                style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, width: size, height: size, opacity: imageLoaded ? 1 : 0 }}
                onLoad={() => {
                    loadedSourceKeys.add(sourceKey);
                    setLoadedKey(sourceKey);
                }}
                onError={() => {
                    setLoadedKey('');
                }}
            />
        </View>
    );
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

const AvatarImage = memo(
    function AvatarImage({ href, size, loaded, onLoad }) {
        return (
            <SvgImage
                href={href}
                x="0"
                y="0"
                width={size}
                height={size}
                preserveAspectRatio="xMidYMid slice"
                opacity={loaded ? 1 : 0}
                onLoad={onLoad}
            />
        );
    },
    (prev, next) => prev.href === next.href && prev.size === next.size && prev.loaded === next.loaded && prev.onLoad === next.onLoad
);

export default function Avatar({ source, size = 52, style, pointerEvents, active = false, selected = null, bot = false, hideFallbackUntilLoaded = false, assumeImageLoaded = false, onImageLoad }) {
    const { theme } = useTheme();
    const id = useId();
    const { sourceKey, imageSource } = useAvatarImageSource(source);
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
    const handleImageLoad = useCallback(() => {
        if (!sourceKey) {
            return;
        }
        loadedSourceKeys.add(sourceKey);
        setLoadedKey(sourceKey);
        onImageLoad?.(sourceKey);
    }, [onImageLoad, sourceKey]);

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
                    {sourceKey ? (
                        <AvatarImage href={imageSource} size={size} loaded={imageLoaded} onLoad={handleImageLoad} />
                    ) : null}
                    {selectable ? <AnimatedCircle animatedProps={selectedProps} cx={size / 2} cy={size / 2} r={selectedRadius} fill="none" stroke={theme.active} strokeWidth={selectedStroke} /> : null}
                </G>
            </Svg>
            <DotBadge show={active} type="active" size={size} />
        </View>
    );
}
