import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Animated as RNAnimated, Pressable, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Image as SvgImage, Mask, Path, Rect } from 'react-native-svg';
import { avatarSourceKey } from '@veyl/shared/avatar';
import { prefixedId } from '@veyl/shared/utils/display';
import { getDotMetrics } from './dot';
import Icon from '@/components/icon';
import { useTap } from '@/lib/tap';
import { useTheme } from '../providers/themeprovider';
import { prefetchAvatarImage, readAvatarImageCache, subscribeAvatarImageCache } from '../lib/avatarimagecache';

const AVATAR_ANIMATION_MS = 160;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedSvgImage = Animated.createAnimatedComponent(SvgImage);
const loadedSourceKeys = new Set();

export function isAvatarSourceLoaded(source) {
    const sourceKey = avatarSourceKey(source);
    return !!sourceKey && loadedSourceKeys.has(sourceKey);
}

function useAvatarImageSource(source) {
    const sourceKey = avatarSourceKey(source);
    const sourceNumber = typeof source === 'number' ? source : null;
    const cachedSource = useCachedAvatarSource(sourceKey);
    const resolvedKey = cachedSource || sourceKey;
    const imageSource = useMemo(() => {
        if (!resolvedKey) return null;
        return sourceNumber == null ? { uri: resolvedKey } : sourceNumber;
    }, [resolvedKey, sourceNumber]);

    return { sourceKey, imageSource, cachedSource };
}

function isRemoteAvatarSource(sourceKey) {
    return /^https?:\/\//i.test(String(sourceKey || ''));
}

function useCachedAvatarSource(sourceKey) {
    const [cachedSource, setCachedSource] = useState(() => readAvatarImageCache(sourceKey));

    useEffect(() => {
        const current = readAvatarImageCache(sourceKey);
        setCachedSource(current);
        if (!isRemoteAvatarSource(sourceKey) || current) return;

        const unsubscribe = subscribeAvatarImageCache((url, uri) => {
            if (url === sourceKey) {
                setCachedSource(uri);
            }
        });
        void prefetchAvatarImage(sourceKey);
        return unsubscribe;
    }, [sourceKey]);

    return cachedSource;
}

function FadingExpoAvatarImage({ source, sourceKey, size, pointerEvents, contentFit, opacity, onLoad, onError }) {
    return (
        <RNAnimated.View pointerEvents={pointerEvents} style={[StyleSheet.absoluteFillObject, { opacity }]}>
            <ExpoImage
                pointerEvents={pointerEvents}
                source={source}
                recyclingKey={sourceKey}
                cachePolicy="memory-disk"
                transition={0}
                contentFit={contentFit}
                style={{ width: size, height: size }}
                onLoad={onLoad}
                onError={onError}
            />
        </RNAnimated.View>
    );
}

export function StaticAvatar({ source, size = 52, style, pointerEvents, contentFit = 'cover', bot = false, glyphColor, glyphScale = 1 }) {
    const { theme } = useTheme();
    const resolvedGlyphColor = glyphColor ?? theme.foreground;
    const { sourceKey, imageSource } = useAvatarImageSource(source);

    if (!sourceKey) {
        return (
            <View pointerEvents={pointerEvents} style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: theme.background }, style]}>
                <Svg width={size} height={size} pointerEvents={pointerEvents}>
                    <Rect x="0" y="0" width={size} height={size} fill={theme.background} />
                    <AvatarGlyph bot={bot} size={size} color={resolvedGlyphColor} glyphScale={glyphScale} />
                </Svg>
            </View>
        );
    }

    return (
        <StaticAvatarImageLayer
            key={sourceKey}
            sourceKey={sourceKey}
            source={imageSource}
            size={size}
            style={style}
            pointerEvents={pointerEvents}
            contentFit={contentFit}
            bot={bot}
            glyphColor={resolvedGlyphColor}
            glyphScale={glyphScale}
            backgroundColor={theme.background}
        />
    );
}

function StaticAvatarImageLayer({ source, sourceKey, size, style, pointerEvents, contentFit, bot, glyphColor, glyphScale, backgroundColor }) {
    const imageProgress = useRef(new RNAnimated.Value(isAvatarSourceLoaded(sourceKey) ? 1 : 0)).current;
    const fallbackOpacity = useMemo(
        () =>
            imageProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0],
            }),
        [imageProgress]
    );
    const animateImageProgress = useCallback(
        (toValue, duration = AVATAR_ANIMATION_MS) => {
            imageProgress.stopAnimation();
            RNAnimated.timing(imageProgress, {
                toValue,
                duration,
                useNativeDriver: true,
            }).start();
        },
        [imageProgress]
    );
    const handleImageLoad = useCallback(() => {
        if (!sourceKey) return;
        const wasLoaded = isAvatarSourceLoaded(sourceKey);
        loadedSourceKeys.add(sourceKey);
        animateImageProgress(1, wasLoaded ? 0 : AVATAR_ANIMATION_MS);
    }, [animateImageProgress, sourceKey]);
    const handleImageError = useCallback(() => {
        if (sourceKey) {
            loadedSourceKeys.delete(sourceKey);
        }
        animateImageProgress(0);
    }, [animateImageProgress, sourceKey]);

    useEffect(() => {
        imageProgress.stopAnimation();
        imageProgress.setValue(isAvatarSourceLoaded(sourceKey) ? 1 : 0);
    }, [imageProgress, sourceKey]);

    return (
        <View pointerEvents={pointerEvents} style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor }, style]}>
            <RNAnimated.View pointerEvents={pointerEvents} style={[StyleSheet.absoluteFillObject, { opacity: fallbackOpacity }]}>
                <Svg width={size} height={size} pointerEvents={pointerEvents}>
                    <Rect x="0" y="0" width={size} height={size} fill={backgroundColor} />
                    <AvatarGlyph bot={bot} size={size} color={glyphColor} glyphScale={glyphScale} />
                </Svg>
            </RNAnimated.View>
            <FadingExpoAvatarImage
                source={source}
                sourceKey={sourceKey}
                size={size}
                pointerEvents={pointerEvents}
                contentFit={contentFit}
                opacity={imageProgress}
                onLoad={handleImageLoad}
                onError={handleImageError}
            />
        </View>
    );
}

function AvatarGlyph({ bot, size, color, glyphScale = 1 }) {
    const glyphSize = (bot ? size * 0.7 : size * 1.1) * glyphScale;
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

const AvatarImageLayer = memo(
    function AvatarImageLayer({ href, size, loaded, alreadyLoaded, onLoad, showFallback, bot, color, glyphScale }) {
        const progress = useSharedValue(loaded && alreadyLoaded ? 1 : 0);
        const imageProps = useAnimatedProps(() => ({
            opacity: progress.value,
        }));
        const fallbackProps = useAnimatedProps(() => ({
            opacity: 1 - progress.value,
        }));

        useEffect(() => {
            if (!loaded) {
                progress.value = 0;
                return;
            }
            progress.value = withTiming(1, { duration: AVATAR_ANIMATION_MS });
        }, [loaded, progress]);

        return (
            <>
                {showFallback ? (
                    <AnimatedG animatedProps={fallbackProps}>
                        <AvatarGlyph bot={bot} size={size} color={color} glyphScale={glyphScale} />
                    </AnimatedG>
                ) : null}
                <AnimatedSvgImage animatedProps={imageProps} href={href} x="0" y="0" width={size} height={size} preserveAspectRatio="xMidYMid slice" onLoad={onLoad} />
            </>
        );
    },
    (prev, next) =>
        prev.href === next.href &&
        prev.size === next.size &&
        prev.loaded === next.loaded &&
        prev.alreadyLoaded === next.alreadyLoaded &&
        prev.onLoad === next.onLoad &&
        prev.showFallback === next.showFallback &&
        prev.bot === next.bot &&
        prev.color === next.color &&
        prev.glyphScale === next.glyphScale
);

function getMaskId(id) {
    return prefixedId('avatar-mask', id);
}

function getAdornmentSize(metrics) {
    return metrics.outerSize ?? metrics.dotSize ?? 0;
}

function getAdornmentCenterX(metrics) {
    return metrics.centerX ?? metrics.center ?? 0;
}

function getAdornmentCenterY(metrics) {
    return metrics.centerY ?? metrics.center ?? 0;
}

function normalizeMaskAdornment(adornment, index) {
    if (!adornment || adornment.show === false) return null;
    const outerSize = getAdornmentSize(adornment);
    if (!outerSize) return null;

    return {
        key: adornment.key ?? `adornment-${index}`,
        centerX: getAdornmentCenterX(adornment),
        centerY: getAdornmentCenterY(adornment),
        radius: adornment.maskRadius ?? outerSize / 2,
    };
}

export function getAvatarAdornmentMetrics(size, { type = 'dot' } = {}) {
    if (type === 'action') {
        const sizeRatio = Math.max(1, size) / 48;
        const buttonScale = Math.sqrt(sizeRatio);
        const iconScale = Math.pow(sizeRatio, 0.25);
        const innerSize = Math.round(22 * buttonScale);
        const maskInset = Math.max(3, Math.round(2.5 * buttonScale));
        const outerSize = innerSize + maskInset * 2;
        const centerX = size * 0.85355;
        const centerY = size * 0.14645;

        return {
            outerSize,
            innerSize,
            iconSize: Math.round(14 * iconScale),
            centerX,
            centerY,
            left: centerX - outerSize / 2,
            top: centerY - outerSize / 2,
            maskRadius: outerSize / 2,
        };
    }

    const dot = getDotMetrics(size);
    return {
        ...dot,
        outerSize: dot.dotSize,
        centerX: dot.center,
        centerY: dot.center,
        maskRadius: dot.dotSize / 2,
    };
}

export function AvatarAdornment({ metrics, show = true, icon, color, iconColor, iconSize, strokeWidth = 4, onPress, disabled = false, hitSlop = 8, style }) {
    const { theme } = useTheme();
    const press = useTap({ disabled: disabled || !onPress || !show, onPress, scale: 0.88 });
    const outerSize = getAdornmentSize(metrics);
    const innerSize = metrics?.innerSize ?? outerSize;
    const resolvedColor = color ?? theme.active;
    const resolvedIconColor = iconColor ?? theme.background;
    const content = (
        <RNAnimated.View style={{ transform: [{ scale: press.scale }] }}>
            <View style={{ width: outerSize, height: outerSize, borderRadius: outerSize / 2, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: innerSize, height: innerSize, borderRadius: innerSize / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: resolvedColor }}>
                    {icon ? <Icon icon={icon} size={iconSize ?? metrics?.iconSize ?? Math.round(innerSize * 0.58)} strokeWidth={strokeWidth} color={resolvedIconColor} /> : null}
                </View>
            </View>
        </RNAnimated.View>
    );
    const baseStyle = [
        {
            position: 'absolute',
            left: metrics?.left ?? getAdornmentCenterX(metrics) - outerSize / 2,
            top: metrics?.top ?? getAdornmentCenterY(metrics) - outerSize / 2,
            width: outerSize,
            height: outerSize,
            borderRadius: outerSize / 2,
            alignItems: 'center',
            justifyContent: 'center',
        },
        style,
    ];

    if (!show || !outerSize) {
        return null;
    }

    if (onPress) {
        return (
            <Pressable {...press.props} disabled={disabled} hitSlop={hitSlop} style={baseStyle}>
                {content}
            </Pressable>
        );
    }

    return (
        <View pointerEvents="none" style={baseStyle}>
            {content}
        </View>
    );
}

export default function Avatar({
    source,
    size = 52,
    style,
    pointerEvents,
    active = false,
    selected = null,
    bot = false,
    glyphColor,
    glyphScale = 1,
    hideFallbackUntilLoaded = false,
    assumeImageLoaded = false,
    onImageLoad,
    maskAdornments = [],
}) {
    const { theme } = useTheme();
    const resolvedGlyphColor = glyphColor ?? theme.foreground;
    const id = useId();
    const { sourceKey, imageSource, cachedSource } = useAvatarImageSource(source);
    const [loadedKey, setLoadedKey] = useState(() => (sourceKey && loadedSourceKeys.has(sourceKey) ? sourceKey : ''));
    const alreadyLoaded = !!sourceKey && (assumeImageLoaded || loadedSourceKeys.has(sourceKey));
    const imageLoaded = !!sourceKey && (alreadyLoaded || !!cachedSource || loadedKey === sourceKey);
    const dot = useMemo(() => getAvatarAdornmentMetrics(size), [size]);
    const maskItems = useMemo(() => [active ? { key: 'active', ...dot } : null, ...maskAdornments].map(normalizeMaskAdornment).filter(Boolean), [active, dot, maskAdornments]);
    const selectable = selected != null;
    const maskId = useMemo(() => getMaskId(id), [id]);
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
                        {maskItems.map((item) => (
                            <Circle key={item.key} cx={item.centerX} cy={item.centerY} r={item.radius} fill="black" />
                        ))}
                    </Mask>
                </Defs>
                <G mask={`url(#${maskId})`}>
                    <Rect x="0" y="0" width={size} height={size} fill={theme.background} />
                    {sourceKey ? (
                        <AvatarImageLayer
                            key={sourceKey}
                            href={imageSource}
                            size={size}
                            loaded={imageLoaded}
                            alreadyLoaded={alreadyLoaded}
                            onLoad={handleImageLoad}
                            showFallback={!hideFallbackUntilLoaded}
                            bot={bot}
                            color={resolvedGlyphColor}
                            glyphScale={glyphScale}
                        />
                    ) : (
                        <AvatarGlyph bot={bot} size={size} color={resolvedGlyphColor} glyphScale={glyphScale} />
                    )}
                    {selectable ? <AnimatedCircle animatedProps={selectedProps} cx={size / 2} cy={size / 2} r={selectedRadius} fill="none" stroke={theme.active} strokeWidth={selectedStroke} /> : null}
                </G>
            </Svg>
            <AvatarAdornment metrics={dot} show={active} color={theme.active} />
        </View>
    );
}
