'use client';

import { Card } from '@/components/card';
import { Button } from '@/components/button';

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
    const content = children ?? (data?.description ? <p className="text-muted">{data.description}</p> : null);
    const cancelAction = onCancel ?? data?.onCancel ?? close;
    const confirmAction = onConfirm ?? data?.onConfirm;
    const handleCancel = () => {
        cancelAction?.();
    };
    const handleConfirm = () => {
        confirmAction?.();
        if (data && data.closeOnConfirm !== false) {
            close?.();
        }
    };

    return (
        <div className={`flex flex-col gap-3 ${width}`}>
            <Card className="p-2">
                <div className="px-4 pt-2 text-2xl leading-none font-black">{title ?? data?.title}</div>
                {content ? <div className="flex flex-col gap-3 px-4 py-2">{content}</div> : null}
            </Card>
            <div className="flex gap-2">
                <Button className="button-outline shrinker flex-1" onClick={handleCancel} disabled={busy}>
                    {cancelLabel}
                </Button>
                <Button className={`${confirmClassName} shrinker flex-1`} onClick={handleConfirm} disabled={disabled || busy}>
                    {confirmIcon}
                    {confirmLabel}
                </Button>
            </div>
        </div>
    );
}
