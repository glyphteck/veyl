import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { Gesture } from 'react-native-gesture-handler';

const TAP_DECISION_MS = 180;
const OPEN_BLOCK_MS = 420;

export function useMediaTapGesture({ disabled = false, msg, onLike, onOpen }) {
    const lastTapRef = useRef(0);
    const openBlockUntilRef = useRef(0);
    const tapTimerRef = useRef(null);
    const canLike = typeof onLike === 'function';

    useEffect(
        () => () => {
            if (tapTimerRef.current) {
                clearTimeout(tapTimerRef.current);
                tapTimerRef.current = null;
            }
        },
        []
    );

    const triggerLike = useCallback(() => {
        if (!canLike) {
            return;
        }
        Haptics.selectionAsync().catch(() => {});
        onLike(msg);
    }, [canLike, msg, onLike]);

    const handleTap = useCallback(() => {
        const now = Date.now();
        const isDoubleTap = canLike && now - lastTapRef.current <= TAP_DECISION_MS;

        if (isDoubleTap) {
            lastTapRef.current = 0;
            openBlockUntilRef.current = now + OPEN_BLOCK_MS;
            if (tapTimerRef.current) {
                clearTimeout(tapTimerRef.current);
                tapTimerRef.current = null;
            }
            triggerLike();
            return;
        }

        lastTapRef.current = now;
        if (tapTimerRef.current) {
            clearTimeout(tapTimerRef.current);
            tapTimerRef.current = null;
        }

        if (now < openBlockUntilRef.current) {
            lastTapRef.current = now;
            openBlockUntilRef.current = now + OPEN_BLOCK_MS;
            return;
        }

        if (!disabled && typeof onOpen === 'function') {
            tapTimerRef.current = setTimeout(() => {
                tapTimerRef.current = null;
                lastTapRef.current = 0;
                onOpen();
            }, TAP_DECISION_MS);
        }
    }, [canLike, disabled, onOpen, triggerLike]);

    return useMemo(
        () =>
            Gesture.Tap()
                .enabled(!disabled || canLike)
                .maxDuration(240)
                .maxDistance(18)
                .runOnJS(true)
                .onEnd((_event, success) => {
                    if (success) {
                        handleTap();
                    }
                }),
        [canLike, disabled, handleTap]
    );
}
