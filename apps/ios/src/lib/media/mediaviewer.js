import { getImageAspect } from '@veyl/shared/chat/messages';

export const LINE_H = 6;

const SLIDER_SLOP = 32;
const LANDSCAPE_ASPECT_MIN = 1.1;

export function clamp(value, min, max) {
    'worklet';
    return Math.max(min, Math.min(max, value));
}

export function getMediaRect(stageW, stageH, aspect) {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const widthByHeight = stageH * safeAspect;
    const heightByWidth = stageW / safeAspect;
    const width = widthByHeight <= stageW ? widthByHeight : stageW;
    const height = widthByHeight <= stageW ? stageH : heightByWidth;

    return {
        left: Math.round((stageW - width) / 2),
        top: Math.round((stageH - height) / 2),
        width: Math.round(width),
        height: Math.round(height),
        lineTop: Math.max(0, Math.round(height - LINE_H)),
    };
}

export function getViewerLayout(screenW, screenH, aspect, orientation) {
    if (orientation === 'landscape') {
        const stageW = Math.max(screenW, screenH);
        const stageH = Math.min(screenW, screenH);

        return {
            landscape: true,
            rotate: '90deg',
            screenW,
            screenH,
            stageW,
            stageH,
            stageLeft: Math.round((screenW - stageW) / 2),
            stageTop: Math.round((screenH - stageH) / 2),
        };
    }

    return {
        landscape: false,
        rotate: '0deg',
        screenW,
        screenH,
        stageW: screenW,
        stageH: screenH,
        stageLeft: 0,
        stageTop: 0,
    };
}

export function pointToStage(x, y, layout) {
    'worklet';
    if (!layout.landscape) {
        return { x, y };
    }

    const cx = layout.stageLeft + layout.stageW / 2;
    const cy = layout.stageTop + layout.stageH / 2;
    const dx = x - cx;
    const dy = y - cy;

    return {
        x: dy + layout.stageW / 2,
        y: -dx + layout.stageH / 2,
    };
}

export function pointInMedia(point, rect) {
    'worklet';
    return point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;
}

export function isSliderHit(point, rect) {
    'worklet';
    if (point.x < rect.left || point.x > rect.left + rect.width) {
        return false;
    }
    const y = point.y - rect.top;
    return y >= rect.lineTop - SLIDER_SLOP && y <= rect.lineTop + LINE_H + SLIDER_SLOP;
}

export function sliderProgress(point, rect) {
    'worklet';
    return clamp((point.x - rect.left) / rect.width, 0, 1);
}

export function getGesturePoint(event) {
    'worklet';
    const touch = event?.allTouches?.[0] || event?.changedTouches?.[0];
    return {
        x: touch?.x ?? event.x,
        y: touch?.y ?? event.y,
    };
}

export function getMediaAspect(item) {
    const aspect = Number(item?.aspect);
    if (Number.isFinite(aspect) && aspect > 0) {
        return aspect;
    }
    return getImageAspect(item?.msg, item?.type === 'mp4' ? 16 / 9 : 4 / 3);
}

export function getMediaOrientation(item, aspect) {
    if (Number.isFinite(aspect) && aspect > 0) {
        return aspect >= LANDSCAPE_ASPECT_MIN ? 'landscape' : 'portrait';
    }
    return item?.orientation === 'landscape' ? 'landscape' : 'portrait';
}
