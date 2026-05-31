'use client';

import { useEffect, useRef } from 'react';
import { Card } from '@/components/card';
import { Button } from '@/components/button';
import { cn } from '@/lib/classes';

function focusButton(button) {
    if (!button || button.disabled) return false;
    button.focus({ preventScroll: true });
    return true;
}

export default function Alert({
    data,
    close,
    title,
    children,
    cancelLabel = data?.cancelLabel ?? 'cancel',
    confirmLabel = data?.confirmLabel ?? 'confirm',
    confirmIcon = data?.confirmIcon,
    confirmClassName = data?.confirmClassName ?? 'button-destructive',
    onCancel,
    onConfirm,
    disabled = data?.disabled ?? false,
    busy = data?.busy ?? false,
    width = data?.width ?? 'w-xs',
}) {
    const cancelRef = useRef(null);
    const confirmRef = useRef(null);
    const content = children ?? (data?.description ? <p className="text-muted">{data.description}</p> : null);
    const cancelAction = onCancel ?? data?.onCancel ?? close;
    const confirmAction = onConfirm ?? data?.onConfirm;

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            if (focusButton(confirmRef.current)) return;
            focusButton(cancelRef.current);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [busy, disabled]);

    const handleCancel = () => {
        cancelAction?.();
    };
    const handleConfirm = () => {
        confirmAction?.();
        if (data && data.closeOnConfirm !== false) {
            close?.();
        }
    };
    const handleKeyDown = (event) => {
        if (event.key !== 'Tab') return;

        const cancelButton = cancelRef.current;
        const confirmButton = confirmRef.current;
        const buttons = [cancelButton, confirmButton].filter((button) => button && !button.disabled);

        if (!buttons.length) return;

        event.preventDefault();
        event.stopPropagation();

        if (buttons.length === 1) {
            focusButton(buttons[0]);
            return;
        }

        focusButton(document.activeElement === confirmButton ? cancelButton : confirmButton);
    };

    return (
        <div className={cn('flex flex-col gap-3', width)} onKeyDown={handleKeyDown}>
            <Card className="p-2">
                <div className="px-4 pt-2 text-2xl leading-none font-black">{title ?? data?.title}</div>
                {content ? <div className="flex flex-col gap-3 px-4 py-2">{content}</div> : null}
            </Card>
            <div className="flex gap-2">
                <Button ref={cancelRef} className="button-outline shrinker flex-1" onClick={handleCancel} disabled={busy}>
                    {cancelLabel}
                </Button>
                <Button ref={confirmRef} className={cn('shrinker flex-1', confirmClassName)} onClick={handleConfirm} disabled={disabled || busy}>
                    {confirmIcon}
                    {confirmLabel}
                </Button>
            </div>
        </div>
    );
}
