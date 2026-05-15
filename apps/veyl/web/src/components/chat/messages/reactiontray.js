'use client';

import { useEffect, useMemo, useState } from 'react';

export const REACTION_MARK_W = 33;
export const REACTION_MARK_H = 27;
export const REACTION_MARK_INSET = 20;
export const REACTION_MARK_BOTTOM = -20;
export const REACTION_CUTOUT = 4;
export const REACTION_SPACE = 16;
export const REACTION_ANIMATION_MS = 160;

const REACTION_POSITIONS = {
    req: { inset: 24, bottom: -20 },
    img: { inset: 24, bottom: -18 },
    mp3: { inset: 22, bottom: -20 },
    mp4: { inset: 24, bottom: -18 },
    file: { inset: 22, bottom: -20 },
};

function reactionPosition(kind) {
    return REACTION_POSITIONS[kind] || { inset: REACTION_MARK_INSET, bottom: REACTION_MARK_BOTTOM };
}

function useReactionPresence(active) {
    const [present, setPresent] = useState(active);
    const [shown, setShown] = useState(false);

    useEffect(() => {
        if (active) {
            setPresent(true);
            const frame = requestAnimationFrame(() => setShown(true));
            return () => cancelAnimationFrame(frame);
        }

        setShown(false);
        const timeout = setTimeout(() => setPresent(false), REACTION_ANIMATION_MS);
        return () => clearTimeout(timeout);
    }, [active]);

    return { present, shown };
}

function ReactionMark({ position, shown }) {
    return (
        <span
            aria-hidden="true"
            className="pointer-events-none absolute z-10 flex items-center justify-center rounded-full bg-background/70 text-sm leading-none shadow-sm backdrop-blur-sm"
            style={{
                left: position.inset - REACTION_MARK_W / 2,
                bottom: position.bottom,
                width: REACTION_MARK_W,
                height: REACTION_MARK_H,
                opacity: shown ? 1 : 0,
                transform: `scale(${shown ? 1 : 0.45})`,
                transformOrigin: 'center',
                transition: `opacity ${REACTION_ANIMATION_MS}ms ease-out, transform ${REACTION_ANIMATION_MS}ms cubic-bezier(0.2, 1.4, 0.2, 1)`,
            }}
        >
            ❤️
        </span>
    );
}

function useMaskStyle(present, position) {
    return useMemo(() => {
        if (!present) {
            return undefined;
        }

        const centerBelow = Math.max(0, -position.bottom - REACTION_MARK_H / 2);
        const rx = REACTION_MARK_W / 2 + REACTION_CUTOUT;
        const ry = REACTION_MARK_H / 2 + REACTION_CUTOUT;
        const mask = `radial-gradient(ellipse ${rx}px ${ry}px at ${position.inset}px calc(100% + ${centerBelow}px), transparent 98%, #000 100%)`;

        return {
            WebkitMaskImage: mask,
            maskImage: mask,
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskSize: '100% 100%',
            maskSize: '100% 100%',
        };
    }, [position, present]);
}

export default function ReactionTray({ children, active = false, kind }) {
    const position = useMemo(() => reactionPosition(kind), [kind]);
    const { present, shown } = useReactionPresence(active);
    const maskStyle = useMaskStyle(present, position);

    return (
        <div className="inline-flex min-w-0 max-w-full flex-col items-start">
            <div className="relative inline-flex min-w-0 max-w-full">
                <div className="inline-flex min-w-0 max-w-full" style={maskStyle}>
                    {children}
                </div>
                {present ? <ReactionMark position={position} shown={shown} /> : null}
            </div>
            <div
                aria-hidden="true"
                className="shrink-0 transition-[height] ease-out"
                style={{
                    height: active ? REACTION_SPACE : 0,
                    transitionDuration: `${REACTION_ANIMATION_MS}ms`,
                }}
            />
        </div>
    );
}
