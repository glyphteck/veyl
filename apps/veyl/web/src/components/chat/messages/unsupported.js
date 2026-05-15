'use client';

import { stopClick } from './utils';

export default function UnsupportedMessage({ msg }) {
    return (
        <div className="backdrop-blur-sm max-w-full border rounded-round px-3 py-2" onClick={stopClick}>
            <p className="break-words select-text text-muted font-mono text-xs">[unknown message type]: {msg?.c}</p>
        </div>
    );
}
