'use client';

import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { cn } from '@/lib/classes';

const DEFAULT_DURATION = 4000;
const EXIT_DURATION = 160;
const MAX_TOASTS = 4;
const MIDDLE_TRUNCATE_END_CHARS = 12;
const listeners = new Set();
const autoTimers = new Map();
const exitTimers = new Map();
const openTimers = new Map();

let toastCount = 0;
let toasts = [];

function nextToastId() {
    toastCount += 1;
    return `toast-${Date.now()}-${toastCount}`;
}

function emit() {
    const snapshot = [...toasts];
    listeners.forEach((listener) => listener(snapshot));
}

function clearTimer(timers, id) {
    const timer = timers.get(id);
    if (timer) {
        clearTimeout(timer);
        timers.delete(id);
    }
}

function removeToast(id) {
    clearTimer(autoTimers, id);
    clearTimer(exitTimers, id);
    clearTimer(openTimers, id);
    toasts = toasts.filter((item) => item.id !== id);
    emit();
}

function closeToast(id) {
    const ids = id == null ? toasts.map((item) => item.id) : [id];

    ids.forEach((toastId) => {
        clearTimer(autoTimers, toastId);
        clearTimer(exitTimers, toastId);
        clearTimer(openTimers, toastId);
    });

    toasts = toasts.map((item) => (ids.includes(item.id) ? { ...item, open: false } : item));
    emit();

    ids.forEach((toastId) => {
        exitTimers.set(toastId, setTimeout(() => removeToast(toastId), EXIT_DURATION));
    });
}

function scheduleToast(id, duration) {
    clearTimer(autoTimers, id);

    if (duration === Infinity) return;

    const nextDuration = duration ?? DEFAULT_DURATION;
    const startedAt = Date.now();
    toasts = toasts.map((item) => (item.id === id ? { ...item, duration: nextDuration, remaining: nextDuration, startedAt, paused: false } : item));
    emit();

    autoTimers.set(id, setTimeout(() => closeToast(id), nextDuration));
}

function openToast(id) {
    clearTimer(openTimers, id);
    toasts = toasts.map((item) => (item.id === id ? { ...item, open: true } : item));
    emit();

    const item = toasts.find((toastItem) => toastItem.id === id);
    scheduleToast(id, item?.duration);
}

function pauseToast(id) {
    const item = toasts.find((toastItem) => toastItem.id === id);
    if (!item || item.duration === Infinity || item.paused) return;

    clearTimer(autoTimers, id);

    const elapsed = Math.max(0, Date.now() - (item.startedAt || Date.now()));
    const remaining = Math.max(1, (item.remaining ?? item.duration ?? DEFAULT_DURATION) - elapsed);
    toasts = toasts.map((toastItem) => (toastItem.id === id ? { ...toastItem, remaining, paused: true } : toastItem));
    emit();
}

function resumeToast(id) {
    const item = toasts.find((toastItem) => toastItem.id === id);
    if (!item || item.duration === Infinity || !item.paused) return;

    clearTimer(autoTimers, id);

    const remaining = item.remaining ?? item.duration ?? DEFAULT_DURATION;
    const startedAt = Date.now();
    toasts = toasts.map((toastItem) => (toastItem.id === id ? { ...toastItem, startedAt, paused: false } : toastItem));
    emit();

    autoTimers.set(id, setTimeout(() => closeToast(id), remaining));
}

function upsertToast(kind, title, options = {}) {
    const id = options.id || nextToastId();
    const hasToast = toasts.some((item) => item.id === id);
    const duration = options.duration ?? DEFAULT_DURATION;
    const nextToast = {
        id,
        kind,
        title,
        description: options.description,
        descriptionMode: options.descriptionMode,
        duration,
        remaining: duration,
        startedAt: null,
        paused: false,
        icon: options.icon,
        open: hasToast,
    };

    clearTimer(exitTimers, id);
    clearTimer(openTimers, id);

    if (hasToast) {
        toasts = toasts.map((item) => (item.id === id ? nextToast : item));
        scheduleToast(id, duration);
    } else {
        const nextToasts = [...toasts, nextToast];
        const droppedToasts = nextToasts.slice(0, Math.max(0, nextToasts.length - MAX_TOASTS));
        droppedToasts.forEach((item) => {
            clearTimer(autoTimers, item.id);
            clearTimer(exitTimers, item.id);
            clearTimer(openTimers, item.id);
        });
        toasts = nextToasts.slice(-MAX_TOASTS);
        openTimers.set(id, setTimeout(() => openToast(id), 16));
    }

    emit();

    return id;
}

function notify(title, options) {
    return upsertToast('default', title, options);
}

notify.success = (title, options) => upsertToast('success', title, options);
notify.error = (title, options) => upsertToast('error', title, options);
notify.dismiss = closeToast;

export const toast = notify;

function subscribe(listener) {
    listeners.add(listener);
    listener([...toasts]);

    return () => {
        listeners.delete(listener);
    };
}

function useToasts() {
    const [items, setItems] = useState(toasts);

    useEffect(() => subscribe(setItems), []);

    return items;
}

function positionClasses(position) {
    switch (position) {
        case 'top-left':
            return 'left-4 top-4 items-start';
        case 'top-center':
            return 'left-1/2 top-4 -translate-x-1/2 items-center';
        case 'top-right':
            return 'right-4 top-4 items-end';
        case 'bottom-center':
            return 'bottom-4 left-1/2 -translate-x-1/2 items-center';
        case 'bottom-right':
            return 'bottom-4 right-4 items-end';
        case 'bottom-left':
        default:
            return 'bottom-4 left-4 items-start';
    }
}

function toastIcon(item) {
    if (item.icon !== undefined) return item.icon;
    if (item.kind === 'success') return <CircleCheck />;
    if (item.kind === 'error') return <CircleAlert />;
    return null;
}

function iconClassName(kind) {
    if (kind === 'success') return 'text-active';
    if (kind === 'error') return 'text-destructive';
    return 'text-foreground';
}

function MiddleTruncate({ text, endChars = MIDDLE_TRUNCATE_END_CHARS }) {
    const value = String(text || '');
    if (!value || value.length <= endChars + 8) return value;

    return (
        <span className="flex min-w-0 max-w-full items-baseline whitespace-nowrap">
            <span className="min-w-0 overflow-hidden whitespace-nowrap">{value.slice(0, -endChars)}</span>
            <span className="shrink-0">...</span>
            <span className="shrink-0">{value.slice(-endChars)}</span>
        </span>
    );
}

export function Notifications({ position = 'bottom-left', className }) {
    const items = useToasts();

    return (
        <div className={cn('pointer-events-none fixed z-50 flex flex-col gap-2', positionClasses(position), className)}>
            {items.map((item) => {
                const icon = toastIcon(item);

                return (
                    <div
                        key={item.id}
                        role={item.kind === 'error' ? 'alert' : 'status'}
                        aria-live={item.kind === 'error' ? 'assertive' : 'polite'}
                        data-open={item.open ? 'true' : 'false'}
                        onMouseEnter={() => pauseToast(item.id)}
                        onMouseLeave={() => resumeToast(item.id)}
                        className="veyl-toast flex w-fit min-w-0 max-w-96 items-center gap-3 rounded-round bg-background/70 px-4 py-3 shadow backdrop-blur-sm"
                    >
                        {icon ? <div className={cn('flex size-5 shrink-0 items-center justify-center [&>svg]:size-5', iconClassName(item.kind))}>{icon}</div> : null}
                        <div className="min-w-0 flex-1">
                            <div className="text-base font-black leading-tight">{item.title}</div>
                            {item.description ? (
                                <div data-description className="min-w-0 text-sm text-muted">
                                    {item.descriptionMode === 'middle' ? <MiddleTruncate text={item.description} /> : item.description}
                                </div>
                            ) : null}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
