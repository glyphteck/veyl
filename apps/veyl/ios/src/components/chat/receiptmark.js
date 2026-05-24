import { useCallback, useEffect, useRef, useState } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Avatar, { StaticAvatar } from '@/components/avatar';

export const RECEIPT_MARK_SIZE = 16;
export const RECEIPT_MARK_RESERVE = RECEIPT_MARK_SIZE + 5;

const RECEIPT_ANIMATION_MS = 160;
const RECEIPT_START_SCALE = 0.01;
const RECEIPT_EASING = Easing.out(Easing.cubic);

function ReceiptAvatar({ source, bot }) {
    if (!source) {
        return <Avatar pointerEvents="none" source={source} size={RECEIPT_MARK_SIZE} bot={!!bot} />;
    }

    return <StaticAvatar pointerEvents="none" source={source} size={RECEIPT_MARK_SIZE} bot={!!bot} />;
}

export default function ReceiptMark({ show, source, bot, frozen = false }) {
    const [present, setPresent] = useState(show);
    const prevShowRef = useRef(show);
    const visibleRef = useRef(show);
    const entryTimerRef = useRef(null);
    const exitTimerRef = useRef(null);
    const rowSpace = useSharedValue(show ? RECEIPT_MARK_RESERVE : 0);
    const opacity = useSharedValue(show ? 1 : 0);
    const scale = useSharedValue(show ? 1 : RECEIPT_START_SCALE);
    const rowSpaceStyle = useAnimatedStyle(() => ({
        height: rowSpace.value,
    }));
    const markStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ scale: scale.value }],
    }));
    const clearTimers = useCallback(() => {
        if (entryTimerRef.current) {
            clearTimeout(entryTimerRef.current);
            entryTimerRef.current = null;
        }
        if (exitTimerRef.current) {
            clearTimeout(exitTimerRef.current);
            exitTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        clearTimers();
        const timing = { duration: RECEIPT_ANIMATION_MS, easing: RECEIPT_EASING };
        if (frozen) {
            prevShowRef.current = show;
            visibleRef.current = show;
            setPresent(show);
            rowSpace.value = show ? RECEIPT_MARK_RESERVE : 0;
            opacity.value = show ? 1 : 0;
            scale.value = show ? 1 : RECEIPT_START_SCALE;
            return undefined;
        }
        if (!show) {
            prevShowRef.current = false;
            if (!visibleRef.current) {
                setPresent(false);
                rowSpace.value = withTiming(0, timing);
                return undefined;
            }
            visibleRef.current = false;
            opacity.value = withTiming(0, timing);
            scale.value = withTiming(RECEIPT_START_SCALE, timing);
            exitTimerRef.current = setTimeout(() => {
                exitTimerRef.current = null;
                setPresent(false);
                rowSpace.value = withTiming(0, timing);
            }, RECEIPT_ANIMATION_MS);
            return undefined;
        }

        const wasShown = prevShowRef.current;
        prevShowRef.current = true;
        rowSpace.value = withTiming(RECEIPT_MARK_RESERVE, timing);
        if (wasShown && visibleRef.current) {
            setPresent(true);
            opacity.value = withTiming(1, timing);
            scale.value = withTiming(1, timing);
            return undefined;
        }
        visibleRef.current = false;
        setPresent(false);
        opacity.value = 0;
        scale.value = RECEIPT_START_SCALE;
        entryTimerRef.current = setTimeout(() => {
            entryTimerRef.current = null;
            visibleRef.current = true;
            setPresent(true);
            opacity.value = 0;
            scale.value = RECEIPT_START_SCALE;
            requestAnimationFrame(() => {
                opacity.value = withTiming(1, timing);
                scale.value = withTiming(1, timing);
            });
        }, RECEIPT_ANIMATION_MS);
        return undefined;
    }, [clearTimers, frozen, opacity, rowSpace, scale, show]);

    useEffect(() => clearTimers, [clearTimers]);

    const forcePresent = frozen && show;
    const containerStyle = forcePresent ? { height: RECEIPT_MARK_RESERVE } : rowSpaceStyle;
    const avatarStyle = forcePresent ? { opacity: 1, transform: [{ scale: 1 }] } : markStyle;

    return (
        <Animated.View pointerEvents="none" style={[{ alignSelf: 'flex-end', overflow: 'hidden' }, containerStyle]}>
            {forcePresent || present ? (
                <Animated.View style={[{ marginTop: 5, paddingRight: 4, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center' }, avatarStyle]}>
                    <ReceiptAvatar source={source} bot={bot} />
                </Animated.View>
            ) : null}
        </Animated.View>
    );
}
