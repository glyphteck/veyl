'use client';

import { useEffect, useState } from 'react';
import { MESSAGE_ROW_ANIMATION_MS } from '../rowmotion';

export default function Dot({ show, failed, saved = false, side = 'right' }) {
    const [visualSaved, setVisualSaved] = useState(saved);

    useEffect(() => {
        if (show || saved) {
            setVisualSaved(saved);
            return undefined;
        }

        const timeout = setTimeout(() => setVisualSaved(false), MESSAGE_ROW_ANIMATION_MS);
        return () => clearTimeout(timeout);
    }, [saved, show]);

    const colorClassName = failed ? 'bg-destructive' : visualSaved ? 'bg-foreground' : 'bg-active';
    return (
        <div
            aria-hidden="true"
            className="pointer-events-none flex h-2 shrink-0 items-center justify-center overflow-hidden ease-out"
            style={{
                marginLeft: side === 'right' && show ? 8 : 0,
                marginRight: side === 'left' && show ? 8 : 0,
                opacity: show ? 1 : 0,
                transform: `scale(${show ? 1 : 0.65})`,
                transitionDuration: `${MESSAGE_ROW_ANIMATION_MS}ms`,
                transitionProperty: 'opacity, width, margin, transform',
                width: show ? 8 : 0,
            }}
        >
            <div className={`size-2 rounded-full shadow-sm ${colorClassName}`} />
        </div>
    );
}
