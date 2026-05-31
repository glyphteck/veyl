import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { Gesture } from 'react-native-gesture-handler';

const MEDIA_TAP_PAIR_MS = 260;
const MEDIA_REACTION_BURST_MS = 420;
const MEDIA_TAP_MAX_DURATION_MS = 360;
const MEDIA_TAP_MAX_DISTANCE = 24;

function blockGesture(gesture, blockExternalGestures) {
    const gestures = (Array.isArray(blockExternalGestures) ? blockExternalGestures : [blockExternalGestures]).filter(Boolean);
    return gestures.length ? gesture.blocksExternalGesture(...gestures) : gesture;
}

function disabledTapGesture() {
    return Gesture.Tap().enabled(false);
}

export function useMediaTapGesture({ blockExternalGestures, disabled = false, msg, onLike, onOpen }) {
    const canLike = typeof onLike === 'function';
    const canOpen = !disabled && typeof onOpen === 'function';
    const latestRef = useRef({ canLike, canOpen, msg, onLike, onOpen });
    const pendingTapRef = useRef({ at: 0, openOnExpire: false, secondDown: false, timeoutId: null });
    const reactionBurstUntilRef = useRef(0);

    latestRef.current = { canLike, canOpen, msg, onLike, onOpen };

    const clearPendingTap = useCallback(() => {
        const pending = pendingTapRef.current;
        if (pending.timeoutId) {
            clearTimeout(pending.timeoutId);
        }
        pendingTapRef.current = { at: 0, openOnExpire: false, secondDown: false, timeoutId: null };
    }, []);

    useEffect(() => clearPendingTap, [clearPendingTap]);

    const react = useCallback(() => {
        const latest = latestRef.current;
        if (!latest.canLike || typeof latest.onLike !== 'function') {
            return;
        }
        Haptics.selectionAsync().catch(() => {});
        latest.onLike(latest.msg);
    }, []);

    const open = useCallback(() => {
        const latest = latestRef.current;
        if (!latest.canOpen || typeof latest.onOpen !== 'function') {
            return;
        }
        latest.onOpen();
    }, []);

    const startPendingTap = useCallback(
        (at, openOnExpire) => {
            clearPendingTap();
            pendingTapRef.current = {
                at,
                openOnExpire,
                secondDown: false,
                timeoutId: setTimeout(() => {
                    const pending = pendingTapRef.current;
                    const shouldOpen = pending.at === at && pending.openOnExpire;
                    pendingTapRef.current = { at: 0, openOnExpire: false, secondDown: false, timeoutId: null };
                    if (shouldOpen) {
                        open();
                    }
                }, MEDIA_TAP_PAIR_MS),
            };
        },
        [clearPendingTap, open]
    );

    const handleTap = useCallback(() => {
        const latest = latestRef.current;
        const now = Date.now();
        const pending = pendingTapRef.current;
        const doubleTap = latest.canLike && pending.at > 0 && now - pending.at <= MEDIA_TAP_PAIR_MS;
        const pairedAttempt = pending.secondDown;

        if (doubleTap) {
            clearPendingTap();
            reactionBurstUntilRef.current = now + MEDIA_REACTION_BURST_MS;
            react();
            return;
        }

        if (pairedAttempt) {
            clearPendingTap();
            return;
        }

        clearPendingTap();
        if (!latest.canLike) {
            open();
            return;
        }

        const inReactionBurst = now <= reactionBurstUntilRef.current;
        if (inReactionBurst) {
            reactionBurstUntilRef.current = now + MEDIA_REACTION_BURST_MS;
        }
        startPendingTap(now, latest.canOpen && !inReactionBurst);
    }, [clearPendingTap, open, react, startPendingTap]);

    const holdPendingTap = useCallback(() => {
        const latest = latestRef.current;
        const pending = pendingTapRef.current;
        if (!latest.canLike || !pending.at) {
            return;
        }

        if (Date.now() - pending.at > MEDIA_TAP_PAIR_MS) {
            clearPendingTap();
            return;
        }

        if (pending.timeoutId) {
            clearTimeout(pending.timeoutId);
        }
        pendingTapRef.current = { ...pending, secondDown: true, timeoutId: null };
    }, [clearPendingTap]);

    const cancelHeldTap = useCallback(() => {
        if (pendingTapRef.current.secondDown) {
            clearPendingTap();
        }
    }, [clearPendingTap]);

    const tap = useMemo(
        () =>
            blockGesture(
                Gesture.Tap()
                    .enabled(canLike || canOpen)
                    .maxDuration(MEDIA_TAP_MAX_DURATION_MS)
                    .maxDistance(MEDIA_TAP_MAX_DISTANCE)
                    .shouldCancelWhenOutside(false)
                    .runOnJS(true)
                    .onTouchesDown(holdPendingTap)
                    .onEnd((_event, success) => {
                        if (success) {
                            handleTap();
                        }
                    })
                    .onFinalize((_event, success) => {
                        if (!success) {
                            cancelHeldTap();
                        }
                    }),
                blockExternalGestures
            ),
        [blockExternalGestures, cancelHeldTap, canLike, canOpen, handleTap, holdPendingTap]
    );

    return useMemo(() => {
        if (canLike || canOpen) {
            return tap;
        }
        return disabledTapGesture();
    }, [canLike, canOpen, tap]);
}
