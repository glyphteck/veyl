'use client';

import { Card } from '@/components/card';
import { Button } from '@/components/button';

export default function Alert({ title, children, cancelLabel = 'cancel', confirmLabel = 'confirm', confirmIcon, confirmClassName = 'button-destructive', onCancel, onConfirm, disabled = false, busy = false, width = 'w-xs' }) {
    return (
        <div className={`flex flex-col gap-3 ${width}`}>
            <Card className="p-2">
                <div className="px-4 pt-2 text-2xl leading-none font-black">{title}</div>
                {children ? <div className="flex flex-col gap-3 px-4 py-2">{children}</div> : null}
            </Card>
            <div className="flex gap-2">
                <Button className="button-outline shrinker flex-1" onClick={onCancel} disabled={busy}>
                    {cancelLabel}
                </Button>
                <Button className={`${confirmClassName} shrinker flex-1`} onClick={onConfirm} disabled={disabled || busy}>
                    {confirmIcon}
                    {confirmLabel}
                </Button>
            </div>
        </div>
    );
}
