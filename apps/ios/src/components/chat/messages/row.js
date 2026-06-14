import { Text, View } from 'react-native';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { Reply } from 'lucide-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { TextBubble } from './text';
import { GestureProvider } from './gesturecontext';
import Icon from '@/components/icon';
import { getSystemMsgText } from '@veyl/shared/chat/messages';
import { getDateSeparatorText } from '@veyl/shared/chat/messages/dates';
import { getMessageOrderMs } from '@veyl/shared/chat/state';
import { formatTimeHHMM } from '@veyl/shared/utils/time';
import {
    MESSAGE_ROW_DROP_MS,
    MESSAGE_ROW_EASING,
    MESSAGE_ROW_ENTER_OFFSET_Y,
    MESSAGE_ROW_ENTER_SCALE,
    MESSAGE_ROW_ENTER_STATE_MS,
    MESSAGE_ROW_ENTER_TIMING,
    MESSAGE_ROW_EXIT_ANIMATION_MS,
    MESSAGE_ROW_EXIT_CLEARANCE_PX,
    MESSAGE_ROW_EXIT_EASING,
    MESSAGE_ROW_EXIT_SCALE,
    MESSAGE_ROW_PADDING_BOTTOM,
    MESSAGE_ROW_PADDING_TOP,
    RECEIPT_STAMP_BOTTOM,
    REPLY_HINT_W,
    REPLY_ICON_DELAY,
    REPLY_SPRING,
    REPLY_TRIGGER,
    STAMP_TRAY,
    STAMP_WAIT,
    STAMP_W,
    clamp,
    revealReply,
    roundPx,
} from '@/components/chat/rowmotion';

function getMsgStamp(msg) {
    const ms = getMessageOrderMs(msg);
    return Number.isFinite(ms) && ms !== Infinity ? formatTimeHHMM(ms, true) : '';
}

function useDropRow(dropped) {
    const rowHeight = useSharedValue(0);
    const drop = useSharedValue(0);
    const dropTimerRef = useRef(null);

    const clearDropTimer = useCallback(() => {
        if (dropTimerRef.current) {
            clearTimeout(dropTimerRef.current);
            dropTimerRef.current = null;
        }
    }, []);

    const onRowLayout = useCallback(
        (event) => {
            if (dropped) {
                return;
            }
            const height = roundPx(event?.nativeEvent?.layout?.height);
            if (height > 0) {
                rowHeight.value = height;
            }
        },
        [dropped, rowHeight]
    );

    useEffect(() => {
        clearDropTimer();
        if (!dropped) {
            drop.value = 0;
            return undefined;
        }

        drop.value = 0;
        dropTimerRef.current = setTimeout(() => {
            dropTimerRef.current = null;
            drop.value = withTiming(1, {
                duration: MESSAGE_ROW_DROP_MS,
                easing: MESSAGE_ROW_EASING,
            });
        }, MESSAGE_ROW_EXIT_ANIMATION_MS);

        return clearDropTimer;
    }, [clearDropTimer, drop, dropped]);

    const dropStyle = useAnimatedStyle(() => {
        if (!dropped || rowHeight.value <= 0) {
            return {};
        }
        return {
            height: Math.max(0, rowHeight.value * (1 - drop.value)),
        };
    });

    return { onRowLayout, dropStyle };
}

export function ReportedBubble({ fromPeer = false }) {
    return <TextBubble msg={{ c: 'reported message hidden' }} fromPeer={fromPeer} />;
}

export function Row({ chatPad, msg, rowState = 'present', fromPeer = false, theme, timeGesture, screenW, receiptStamp, stampBottomInset = 0, onReply, onLike, children }) {
    const reply = useSharedValue(0);
    const appear = useSharedValue(rowState === 'entering' ? 0 : 1);
    const exit = useSharedValue(0);
    const exitDistance = useSharedValue(0);
    const exitContentLayoutRef = useRef(null);
    const exitTargetLayoutRef = useRef(null);
    const stamp = useMemo(() => getMsgStamp(msg), [msg?.cid, msg?.id, msg?.ts]);
    const dropped = rowState === 'leaving';
    const entering = rowState === 'entering';
    const instant = rowState === 'instant';
    const canReply = !dropped && typeof onReply === 'function';
    const canLike = !dropped && typeof onLike === 'function';
    const hasPan = canReply;
    const replyIconLeft = fromPeer;
    const { onRowLayout, dropStyle } = useDropRow(dropped);
    const actionRef = useRef({ canLike, canReply, msg, onLike, onReply });

    actionRef.current = { canLike, canReply, msg, onLike, onReply };

    const triggerReply = useCallback(() => {
        const latest = actionRef.current;
        if (!latest.canReply || typeof latest.onReply !== 'function') {
            return;
        }
        Haptics.selectionAsync().catch(() => {});
        latest.onReply(latest.msg);
    }, []);
    const triggerLike = useCallback(() => {
        const latest = actionRef.current;
        if (!latest.canLike || typeof latest.onLike !== 'function') {
            return;
        }
        Haptics.selectionAsync().catch(() => {});
        latest.onLike(latest.msg);
    }, []);
    const replyStyle = useAnimatedStyle(() => {
        const reveal = clamp((Math.abs(reply.value) - REPLY_ICON_DELAY) / 42, 0, 1);
        return {
            opacity: reveal,
            transform: [{ scale: 0.84 + reveal * 0.24 }],
        };
    });

    const contentStyle = useAnimatedStyle(() => {
        const exitTranslate = exitDistance.value * exit.value;
        const exitScale = 1 - exit.value * (1 - MESSAGE_ROW_EXIT_SCALE);
        const enterScale = MESSAGE_ROW_ENTER_SCALE + appear.value * (1 - MESSAGE_ROW_ENTER_SCALE);
        const enterOffsetY = (1 - appear.value) * MESSAGE_ROW_ENTER_OFFSET_Y;
        return {
            transform: [{ translateX: reply.value + exitTranslate }, { translateY: exit.value > 0 ? 0 : enterOffsetY }, { scale: exit.value > 0 ? exitScale : enterScale }],
        };
    });

    const handleExitContentLayout = useCallback((event) => {
        exitContentLayoutRef.current = event.nativeEvent.layout;
    }, []);

    const handleExitTargetLayout = useCallback((event) => {
        exitTargetLayoutRef.current = event.nativeEvent.layout;
    }, []);

    const measureExitTranslate = useCallback(() => {
        const contentLayout = exitContentLayoutRef.current;
        const targetLayout = exitTargetLayoutRef.current || contentLayout;
        if (!contentLayout || !targetLayout || !Number.isFinite(contentLayout.x) || !Number.isFinite(targetLayout.x) || !Number.isFinite(targetLayout.width) || targetLayout.width <= 0) {
            return (screenW + MESSAGE_ROW_EXIT_CLEARANCE_PX) * (fromPeer ? -1 : 1);
        }

        const targetLeft = contentLayout.x + targetLayout.x;
        const targetRight = targetLeft + targetLayout.width;
        const exitsRight = !fromPeer;
        const distance = exitsRight ? screenW - targetLeft : targetRight;
        return Math.ceil(Math.max(0, distance + MESSAGE_ROW_EXIT_CLEARANCE_PX)) * (exitsRight ? 1 : -1);
    }, [fromPeer, screenW]);

    useEffect(() => {
        let enterTimer;
        if (dropped) {
            appear.value = 1;
            exitDistance.value = measureExitTranslate();
            exit.value = withTiming(1, { duration: MESSAGE_ROW_EXIT_ANIMATION_MS, easing: MESSAGE_ROW_EXIT_EASING });
            return undefined;
        }

        exit.value = 0;
        exitDistance.value = 0;
        if (instant) {
            appear.value = 1;
            return undefined;
        }
        if (!entering) {
            appear.value = 1;
            return undefined;
        }

        appear.value = 0;
        appear.value = withTiming(1, MESSAGE_ROW_ENTER_TIMING);
        enterTimer = setTimeout(() => {
            appear.value = 1;
        }, MESSAGE_ROW_ENTER_STATE_MS);
        return () => clearTimeout(enterTimer);
    }, [appear, dropped, entering, exit, exitDistance, instant, measureExitTranslate]);

    const replyGesture = useMemo(() => {
        const gesture = Gesture.Pan()
            .enabled(canReply)
            .activeOffsetX(fromPeer ? 4 : -4)
            .failOffsetY([-10, 10])
            .failOffsetX(fromPeer ? -4 : 4);
        if (!fromPeer && timeGesture) {
            gesture.blocksExternalGesture(timeGesture);
        }
        return gesture
            .onUpdate((event) => {
                'worklet';
                const drag = fromPeer ? Math.max(event.translationX, 0) : Math.max(-event.translationX, 0);
                reply.value = fromPeer ? revealReply(drag) : -revealReply(drag);
            })
            .onEnd((event) => {
                'worklet';
                const drag = fromPeer ? event.translationX : -event.translationX;
                if (drag >= REPLY_TRIGGER && canReply) {
                    scheduleOnRN(triggerReply);
                }
            })
            .onFinalize(() => {
                'worklet';
                reply.value = withSpring(0, REPLY_SPRING);
            });
    }, [canReply, fromPeer, reply, timeGesture, triggerReply]);

    const likeGesture = useMemo(
        () =>
            Gesture.Tap()
                .enabled(canLike)
                .numberOfTaps(2)
                .maxDelay(280)
                .maxDistance(18)
                .runOnJS(true)
                .onEnd((_event, success) => {
                    if (success) {
                        triggerLike();
                    }
                }),
        [canLike, triggerLike]
    );

    const tapGesture = useMemo(() => (canLike ? likeGesture : null), [canLike, likeGesture]);

    const rowGesture = useMemo(() => {
        if (hasPan && tapGesture) {
            return Gesture.Simultaneous(replyGesture, tapGesture);
        }
        if (hasPan) {
            return replyGesture;
        }
        return tapGesture;
    }, [hasPan, replyGesture, tapGesture]);

    const gestureValue = useMemo(() => ({ likeGesture: tapGesture, replyGesture: hasPan ? replyGesture : null, timeGesture: timeGesture || null }), [hasPan, replyGesture, tapGesture, timeGesture]);
    const renderedChildren = typeof children === 'function' ? children({ onExitTargetLayout: handleExitTargetLayout }) : children;
    const content = <GestureProvider value={gestureValue}>{renderedChildren}</GestureProvider>;
    const contentOriginStyle = useMemo(() => ({ transformOrigin: fromPeer ? 'left bottom' : 'right bottom' }), [fromPeer]);
    const contentNode = (
        <Animated.View collapsable={false} onLayout={handleExitContentLayout} style={[contentOriginStyle, contentStyle]}>
            {content}
        </Animated.View>
    );
    const rowBody = (
        <View
            collapsable={false}
            style={{
                position: 'relative',
                width: screenW + STAMP_TRAY,
                paddingTop: MESSAGE_ROW_PADDING_TOP,
                paddingBottom: MESSAGE_ROW_PADDING_BOTTOM,
            }}
        >
            {stamp ? (
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        left: screenW + STAMP_WAIT,
                        top: MESSAGE_ROW_PADDING_TOP,
                        bottom: MESSAGE_ROW_PADDING_BOTTOM + stampBottomInset,
                        width: STAMP_W,
                        justifyContent: 'center',
                        alignItems: 'flex-start',
                    }}
                >
                    <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '800' }}>{stamp}</Text>
                </View>
            ) : null}
            {receiptStamp ? (
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        left: screenW + STAMP_WAIT,
                        bottom: RECEIPT_STAMP_BOTTOM,
                        width: STAMP_W,
                        justifyContent: 'center',
                        alignItems: 'flex-start',
                    }}
                >
                    <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '800' }}>{receiptStamp}</Text>
                </View>
            ) : null}
            {canReply ? (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        {
                            position: 'absolute',
                            left: replyIconLeft ? 12 : undefined,
                            right: replyIconLeft ? undefined : STAMP_TRAY + Math.max(chatPad - 4, 12),
                            top: 0,
                            bottom: 0,
                            width: REPLY_HINT_W,
                            justifyContent: 'center',
                            alignItems: 'center',
                        },
                        replyStyle,
                    ]}
                >
                    <Icon icon={Reply} color={theme.foreground} />
                </Animated.View>
            ) : null}
            <View style={{ width: screenW, paddingHorizontal: chatPad, flexDirection: 'row', justifyContent: fromPeer ? 'flex-start' : 'flex-end' }}>
                {rowGesture ? (
                    <GestureDetector gesture={rowGesture}>{contentNode}</GestureDetector>
                ) : (
                    contentNode
                )}
            </View>
        </View>
    );

    return (
        <Animated.View
            collapsable={false}
            onLayout={onRowLayout}
            pointerEvents={dropped ? 'none' : 'auto'}
            style={[
                {
                    width: screenW + STAMP_TRAY,
                    overflow: 'hidden',
                },
                dropStyle,
            ]}
        >
            {rowBody}
        </Animated.View>
    );
}

export function SystemRow({ chatPad, msg, rowState = 'present', screenW, theme }) {
    const appear = useSharedValue(rowState === 'entering' ? 0 : 1);
    const exit = useSharedValue(0);
    const dropped = rowState === 'leaving';
    const entering = rowState === 'entering';
    const instant = rowState === 'instant';
    const { onRowLayout, dropStyle } = useDropRow(dropped);
    const visualStyle = useAnimatedStyle(() => ({
        opacity: 1 - exit.value,
        transform: [
            { translateY: exit.value > 0 ? 0 : (1 - appear.value) * MESSAGE_ROW_ENTER_OFFSET_Y },
            { scale: exit.value > 0 ? 1 - exit.value * (1 - MESSAGE_ROW_EXIT_SCALE) : MESSAGE_ROW_ENTER_SCALE + appear.value * (1 - MESSAGE_ROW_ENTER_SCALE) },
        ],
    }));

    useEffect(() => {
        let enterTimer;
        if (dropped) {
            appear.value = 1;
            exit.value = withTiming(1, { duration: MESSAGE_ROW_EXIT_ANIMATION_MS, easing: MESSAGE_ROW_EXIT_EASING });
            return undefined;
        }

        exit.value = 0;
        if (instant) {
            appear.value = 1;
            return undefined;
        }
        if (!entering) {
            appear.value = 1;
            return undefined;
        }

        appear.value = 0;
        appear.value = withTiming(1, MESSAGE_ROW_ENTER_TIMING);
        enterTimer = setTimeout(() => {
            appear.value = 1;
        }, MESSAGE_ROW_ENTER_STATE_MS);
        return () => clearTimeout(enterTimer);
    }, [appear, dropped, entering, exit, instant]);

    const text = getDateSeparatorText(msg) || getSystemMsgText(msg);
    const rowBody = (
        <View
            collapsable={false}
            style={{
                width: screenW + STAMP_TRAY,
                paddingTop: 2,
                paddingBottom: 4,
            }}
        >
            <Animated.View collapsable={false} style={[{ width: screenW, paddingHorizontal: chatPad, alignItems: 'center', transformOrigin: 'center bottom' }, visualStyle]}>
                <Text style={{ maxWidth: '76%', color: theme.muted, fontSize: 11, fontWeight: '800', lineHeight: 14, textAlign: 'center' }}>{text}</Text>
            </Animated.View>
        </View>
    );

    return (
        <Animated.View
            onLayout={onRowLayout}
            pointerEvents={dropped ? 'none' : 'auto'}
            style={[
                {
                    width: screenW + STAMP_TRAY,
                    overflow: 'hidden',
                },
                dropStyle,
            ]}
        >
            {rowBody}
        </Animated.View>
    );
}
