'use client';

export function isEditableTarget(target) {
    if (!target) return false;
    if (typeof document !== 'undefined' && target === document) return false;
    if (typeof window !== 'undefined' && target === window) return false;
    const element = typeof Element !== 'undefined' && target instanceof Element ? target : null;
    if (!element) return false;
    const tag = element.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable;
}

export function listNavigationStep(event, { ignoreEditable = true, includeJk = true, includeHorizontal = true } = {}) {
    if (!event || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return 0;
    }
    if (ignoreEditable && isEditableTarget(event.target)) {
        return 0;
    }

    const key = String(event.key || '').toLowerCase();
    if (key === 'arrowdown' || (includeHorizontal && key === 'arrowright') || (includeJk && key === 'j')) return 1;
    if (key === 'arrowup' || (includeHorizontal && key === 'arrowleft') || (includeJk && key === 'k')) return -1;
    return 0;
}

export function loopListIndex(length, currentIndex, step) {
    if (!length || !step) {
        return -1;
    }
    if (currentIndex < 0) {
        return step > 0 ? 0 : length - 1;
    }
    return (currentIndex + step + length) % length;
}
