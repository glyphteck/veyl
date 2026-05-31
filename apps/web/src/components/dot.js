'use client';

import React from 'react';
import { prefixedId } from '@veyl/shared/utils/display';
import { cn } from '@/lib/classes';

const AVATAR_DOT_CENTER = 0.85355;
const AVATAR_DOT_RADIUS = 1 / 6;
const avatarClipPath = [
    'M0 0H1V1H0Z',
    `M${AVATAR_DOT_CENTER} ${AVATAR_DOT_CENTER - AVATAR_DOT_RADIUS}`,
    `A${AVATAR_DOT_RADIUS} ${AVATAR_DOT_RADIUS} 0 1 1 ${AVATAR_DOT_CENTER} ${AVATAR_DOT_CENTER + AVATAR_DOT_RADIUS}`,
    `A${AVATAR_DOT_RADIUS} ${AVATAR_DOT_RADIUS} 0 1 1 ${AVATAR_DOT_CENTER} ${AVATAR_DOT_CENTER - AVATAR_DOT_RADIUS}Z`,
].join(' ');

export function Dot({ show = false, type = 'alert', compact = false, vectorMask = false, className, maskTargetClassName, dotClassName, children, ...props }) {
    const dotColorClass = type === 'active' ? 'bg-active' : 'bg-alert';
    const id = React.useId();
    const clipId = React.useMemo(() => prefixedId('dot-clip', id), [id]);
    const useVectorMask = show && vectorMask && !compact;

    const dotVars = {
        '--badge-dot-size': compact ? 'clamp(calc(100% / 3), 42%, 13px)' : 'calc(100% / 3)',
        '--badge-dot-inset': compact ? '12%' : '14%',
        '--badge-dot-x': 'calc(50% + 35.355%)',
        '--badge-dot-y': 'calc(50% + 35.355%)',
    };

    const maskImage =
        'radial-gradient(circle at var(--badge-dot-x) var(--badge-dot-y), transparent 0 calc(var(--badge-dot-radius) - 0.5px), #000 calc(var(--badge-dot-radius) + 0.5px))';

    return (
        <span
            className={cn('relative inline-flex shrink-0', className)}
            style={{
                ...dotVars,
                '--badge-dot-radius': 'calc(var(--badge-dot-size) / 2)',
            }}
            {...props}
        >
            {useVectorMask ? (
                <svg className="pointer-events-none absolute h-0 w-0" aria-hidden="true" focusable="false">
                    <defs>
                        <clipPath id={clipId} clipPathUnits="objectBoundingBox">
                            <path d={avatarClipPath} clipRule="evenodd" fillRule="evenodd" />
                        </clipPath>
                    </defs>
                </svg>
            ) : null}
            <span
                className={cn('inline-flex', maskTargetClassName)}
                style={
                    show
                        ? useVectorMask
                            ? {
                                  WebkitClipPath: `url(#${clipId})`,
                                  clipPath: `url(#${clipId})`,
                              }
                            : {
                                  WebkitMaskImage: maskImage,
                                  maskImage,
                                  WebkitMaskRepeat: 'no-repeat',
                                  maskRepeat: 'no-repeat',
                                  WebkitMaskSize: '100% 100%',
                                  maskSize: '100% 100%',
                                  WebkitMaskPosition: '0 0',
                                  maskPosition: '0 0',
                              }
                        : undefined
                }
            >
                {children}
            </span>
            {show ? (
                <span
                    className="pointer-events-none absolute left-(--badge-dot-x) top-(--badge-dot-y) z-10 size-(--badge-dot-size) -translate-x-1/2 -translate-y-1/2 rounded-full"
                    aria-hidden
                >
                    <span className={cn('absolute inset-(--badge-dot-inset) rounded-full', dotColorClass, dotClassName)} aria-hidden />
                </span>
            ) : null}
        </span>
    );
}
