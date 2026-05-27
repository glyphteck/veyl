import { Easing, LinearTransition } from 'react-native-reanimated';

export const STAMP_W = 108;
export const STAMP_WAIT = 12;
export const STAMP_TRAY = STAMP_W + STAMP_WAIT;
export const REPLY_DRAG = 24;
export const REPLY_HINT_W = 44;
export const REPLY_TRIGGER = 64;
export const REPLY_ICON_DELAY = 24;
export const MESSAGE_ROW_ANIMATION_MS = 160;
export const MESSAGE_ROW_ENTER_ANIMATION_MS = MESSAGE_ROW_ANIMATION_MS;
export const MESSAGE_ROW_EXIT_ANIMATION_MS = 160;
export const MESSAGE_ROW_DROP_MS = MESSAGE_ROW_ANIMATION_MS;
export const MESSAGE_ROW_LEAVE_MS = MESSAGE_ROW_EXIT_ANIMATION_MS + MESSAGE_ROW_DROP_MS;
export const MESSAGE_ROW_ENTER_STATE_MS = MESSAGE_ROW_ENTER_ANIMATION_MS + 120;
export const MESSAGE_ROW_EASING = Easing.out(Easing.cubic);
export const MESSAGE_ROW_EXIT_EASING = Easing.linear;
export const MESSAGE_ROW_EXIT_CLEARANCE_PX = 1;
export const MESSAGE_ROW_ENTER_SCALE = 0.2;
export const MESSAGE_ROW_ENTER_OFFSET_Y = 10;
export const MESSAGE_ROW_EXIT_SCALE = 0.01;
export const LIKE_BLOCK_MS = 320;
export const MESSAGE_ROW_PADDING_TOP = 4;
export const MESSAGE_ROW_PADDING_BOTTOM = 8;
export const RECEIPT_STAMP_BOTTOM = 7;
export const REPLY_SPRING = {
    mass: 0.16,
    stiffness: 200,
    damping: 4.5,
};
export const MESSAGE_ROW_ENTER_TIMING = { duration: MESSAGE_ROW_ENTER_ANIMATION_MS, easing: MESSAGE_ROW_EASING };
export const MESSAGE_ROW_LAYOUT = LinearTransition.duration(MESSAGE_ROW_ENTER_ANIMATION_MS).easing(MESSAGE_ROW_EASING);

export function roundPx(value) {
    return Math.round(Number.isFinite(value) ? value : 0);
}

export function positivePx(value) {
    return Math.max(0, roundPx(value));
}

export function clamp(value, min, max) {
    'worklet';
    return Math.min(Math.max(value, min), max);
}

export function rubberBand(value, dimension) {
    'worklet';
    if (value <= 0 || dimension <= 0) return 0;
    return (1 - 1 / (value / dimension + 1)) * dimension;
}

export function revealReply(value) {
    'worklet';
    if (value <= 0) return 0;
    if (value <= REPLY_DRAG) return value;
    return REPLY_DRAG + rubberBand(value - REPLY_DRAG, REPLY_HINT_W);
}
