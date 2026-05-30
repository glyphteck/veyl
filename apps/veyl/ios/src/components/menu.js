import { Keyboard, View } from 'react-native';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useMenu } from '@/providers/menuprovider';

const START_SCALE = 0.01;
export const MENU_LONG_PRESS_MS = 420;
const KEYBOARD_DISMISS_FALLBACK_MS = 320;

let nextId = 0;

function makeId() {
    nextId += 1;
    return `menu-${nextId}`;
}

function insetStyle(value) {
    const inset = Math.max(0, Number(value) || 0);
    return inset > 0 ? { paddingBottom: inset, marginBottom: -inset } : undefined;
}

function blockGesture(gesture, blockExternalGestures) {
    const gestures = (Array.isArray(blockExternalGestures) ? blockExternalGestures : [blockExternalGestures]).filter(Boolean);
    return gestures.length ? gesture.blocksExternalGesture(...gestures) : gesture;
}

export default function Menu({
    id,
    children,
    items,
    onHold,
    contentGesture,
    blockExternalGestures,
    disabled = false,
    longScale = 0.96,
    activeStyle,
    renderPreview,
    previewBottomInset = 0,
}) {
    const { activeId, close, open, update } = useMenu();
    const idRef = useRef(makeId());
    const hostRef = useRef(null);
    const layoutRef = useRef(null);
    const releaseRef = useRef(() => {});
    const openTimerRef = useRef(null);
    const openFrameRef = useRef(null);
    const keyboardHideRef = useRef(null);
    const activeRef = useRef(false);
    const latestRef = useRef(null);
    const menuId = id || idRef.current;

    const list = useMemo(() => (Array.isArray(items) ? items.filter(Boolean) : []), [items]);
    const hasMenu = list.length > 0;
    const active = activeId === menuId;
    const blocked = !!activeId && !active;
    const holdTarget = !disabled && (hasMenu || typeof onHold === 'function');
    const canHold = holdTarget && !active && !blocked;
    const paddedStyle = useMemo(() => insetStyle(previewBottomInset), [previewBottomInset]);

    activeRef.current = active;

    useEffect(
        () => () => {
            if (openTimerRef.current) {
                clearTimeout(openTimerRef.current);
                openTimerRef.current = null;
            }
            if (openFrameRef.current) {
                cancelAnimationFrame(openFrameRef.current);
                openFrameRef.current = null;
            }
            keyboardHideRef.current?.remove?.();
            keyboardHideRef.current = null;
            if (activeRef.current) {
                close(menuId);
            }
        },
        [close, menuId]
    );

    useEffect(() => {
        if (active && !hasMenu) {
            close(menuId);
        }
    }, [active, close, hasMenu, menuId]);

    const render = useCallback(() => {
        if (typeof renderPreview === 'function') {
            return renderPreview({ active: true, children });
        }
        return paddedStyle ? <View style={paddedStyle}>{children}</View> : children;
    }, [children, paddedStyle, renderPreview]);

    const updateLayout = useCallback((event) => {
        const { width, height } = event?.nativeEvent?.layout ?? {};
        if (width > 0 && height > 0) {
            layoutRef.current = { width, height };
        }
    }, []);

    useEffect(() => {
        if (!active) {
            return;
        }

        update(menuId, {
            items: list,
            render,
        });
    }, [active, list, menuId, render, update]);

    const measureAndOpen = useCallback(() => {
        openFrameRef.current = null;
        const latest = latestRef.current;

        if (!latest?.open || !hostRef.current?.measureInWindow) {
            releaseRef.current();
            return;
        }

        hostRef.current.measureInWindow((x, y, width, height) => {
            if (!width || !height) {
                releaseRef.current();
                return;
            }

            layoutRef.current = { width, height };
            latest.open({
                id: latest.menuId,
                anchor: { x, y, width, height },
                items: latest.list,
                render: latest.render,
                release: releaseRef.current,
                longScale: latest.longScale,
            });
        });
    }, []);

    const scheduleOpen = useCallback(() => {
        const queueMeasure = () => {
            if (openFrameRef.current) {
                cancelAnimationFrame(openFrameRef.current);
                openFrameRef.current = null;
            }
            openFrameRef.current = requestAnimationFrame(measureAndOpen);
        };

        if (openTimerRef.current) {
            clearTimeout(openTimerRef.current);
            openTimerRef.current = null;
        }
        if (openFrameRef.current) {
            cancelAnimationFrame(openFrameRef.current);
            openFrameRef.current = null;
        }
        keyboardHideRef.current?.remove?.();
        keyboardHideRef.current = null;

        const keyboardVisible = !!Keyboard.metrics?.()?.height;
        if (keyboardVisible) {
            keyboardHideRef.current = Keyboard.addListener('keyboardDidHide', () => {
                keyboardHideRef.current?.remove?.();
                keyboardHideRef.current = null;
                if (openTimerRef.current) {
                    clearTimeout(openTimerRef.current);
                    openTimerRef.current = null;
                }
                queueMeasure();
            });
            Keyboard.dismiss();
            openTimerRef.current = setTimeout(() => {
                openTimerRef.current = null;
                keyboardHideRef.current?.remove?.();
                keyboardHideRef.current = null;
                queueMeasure();
            }, KEYBOARD_DISMISS_FALLBACK_MS);
            return;
        }

        queueMeasure();
    }, [measureAndOpen]);

    const handleLongPress = useCallback(() => {
        const latest = latestRef.current;
        if (!latest?.canHold) {
            return;
        }

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

        if (!latest.hasMenu) {
            latest.onHold?.();
            return;
        }

        scheduleOpen();
    }, [scheduleOpen]);

    latestRef.current = { canHold, hasMenu, list, longScale, menuId, onHold, open, render };

    const longPressGesture = useMemo(() => {
        if (!holdTarget) {
            return null;
        }

        return blockGesture(
            Gesture.LongPress()
                .enabled(canHold)
                .minDuration(MENU_LONG_PRESS_MS)
                .maxDistance(18)
                .runOnJS(true)
                .onStart(handleLongPress),
            blockExternalGestures
        );
    }, [blockExternalGestures, canHold, handleLongPress, holdTarget]);
    const gesture = useMemo(() => {
        if (longPressGesture && contentGesture) {
            return Gesture.Exclusive(contentGesture, longPressGesture);
        }
        return longPressGesture || contentGesture || null;
    }, [contentGesture, longPressGesture]);
    releaseRef.current = () => {};

    if (children == null) {
        return null;
    }

    const activeLayout = active && layoutRef.current ? layoutRef.current : null;
    const content = (
        <View
            ref={hostRef}
            collapsable={false}
            onLayout={active ? undefined : updateLayout}
            style={[
                paddedStyle,
                activeLayout,
                active ? activeStyle || { transform: [{ scale: START_SCALE }] } : null,
            ]}
        >
            {children}
        </View>
    );

    return gesture ? <GestureDetector gesture={gesture}>{content}</GestureDetector> : content;
}
