'use client';

import { stopClick } from '@/lib/chat/messages';

export default function UnsupportedMessage() {
    return (
        <div className="max-w-full rounded-round bg-background/70 px-3 py-2 shadow backdrop-blur-sm" onClick={stopClick}>
            <p className="break-words select-text text-muted text-sm font-bold">this message cannot be shown</p>
        </div>
    );
}
