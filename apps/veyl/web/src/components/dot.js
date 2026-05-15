'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export function Dot({ show = false, type = 'alert', compact = false, className, maskTargetClassName, dotClassName, children, ...props }) {
    const dotColorClass = type === 'active' ? 'bg-active' : 'bg-alert';

    const dotVars = {
        '--badge-dot-size': compact ? 'clamp(calc(100% / 3), 42%, 13px)' : 'calc(100% / 3)',
        '--badge-dot-inset': compact ? '12%' : '14%',
        '--badge-dot-x': 'calc(50% + 35.355%)',
        '--badge-dot-y': 'calc(50% + 35.355%)',
    };

    const maskImage =
        'radial-gradient(circle at var(--badge-dot-x) var(--badge-dot-y), transparent 0 calc(var(--badge-dot-radius) - var(--badge-dot-feather)), rgba(0, 0, 0, 0.65) var(--badge-dot-radius), #000 calc(var(--badge-dot-radius) + var(--badge-dot-feather)))';

    return (
        <span
            className={cn('relative inline-flex shrink-0', className)}
            style={{
                ...dotVars,
                '--badge-dot-radius': 'calc(var(--badge-dot-size) / 2)',
                '--badge-dot-feather': '1px',
            }}
            {...props}
        >
            <span
                className={cn('inline-flex', maskTargetClassName)}
                style={
                    show
                        ? {
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
