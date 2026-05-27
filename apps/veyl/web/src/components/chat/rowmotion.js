'use client';

export const MESSAGE_ROW_ANIMATION_MS = 160;
export const MESSAGE_ROW_EXIT_ANIMATION_MS = 160;
export const MESSAGE_ROW_LEAVE_MS = MESSAGE_ROW_EXIT_ANIMATION_MS + MESSAGE_ROW_ANIMATION_MS;
export const MESSAGE_ROW_EASE = 'cubic-bezier(0.2, 0, 0, 1)';
export const MESSAGE_ROW_EXIT_EASE = 'linear';
export const MESSAGE_ROW_EXIT_CLEARANCE_PX = 1;
export const MESSAGE_ROW_EXIT_SCALE = 0;
export const MESSAGE_ROW_GAP_PX = 8;

export function afterNextPaint(callback) {
    let secondFrame = null;
    const firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(callback);
    });

    return () => {
        cancelAnimationFrame(firstFrame);
        if (secondFrame) {
            cancelAnimationFrame(secondFrame);
        }
    };
}
