'use client';

import * as React from 'react';
import { Bot, UserRound } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Dot } from '@/components/dot';

const AvatarContext = React.createContext(null);

const Avatar = React.forwardRef(function Avatar({ className, active = false, selected = null, bot = false, children, ...props }, ref) {
    const [status, setStatus] = React.useState('idle');
    const selectable = selected != null;

    return (
        <AvatarContext.Provider value={{ status, setStatus, bot }}>
            <div ref={ref} className={cn('avatar shadow-sm relative flex size-10 shrink-0 overflow-visible rounded-full', className)} {...props}>
                <Dot show={active} type="active" className="size-full" maskTargetClassName="relative size-full overflow-hidden rounded-full">
                    {children}
                    {selectable ? (
                        <span className={cn('pointer-events-none absolute inset-0 rounded-full border-[3px] transition-colors ease-out', selected ? 'border-active' : 'border-transparent')} aria-hidden />
                    ) : null}
                </Dot>
            </div>
        </AvatarContext.Provider>
    );
});

const AvatarImage = React.forwardRef(function AvatarImage({ className, src, alt = '', onLoad, onError, ...props }, ref) {
    const avatar = React.useContext(AvatarContext);
    const setStatus = avatar?.setStatus;
    const imgRef = React.useRef(null);

    React.useEffect(() => {
        if (!src) {
            setStatus?.('error');
            return;
        }

        const img = imgRef.current;
        if (img?.complete) {
            setStatus?.(img.naturalWidth > 0 ? 'loaded' : 'error');
            return;
        }

        setStatus?.('loading');
    }, [setStatus, src]);

    if (!src) {
        return null;
    }

    return (
        <img
            ref={(node) => {
                imgRef.current = node;
                if (typeof ref === 'function') {
                    ref(node);
                } else if (ref) {
                    ref.current = node;
                }
            }}
            className={cn('aspect-square size-full select-none pointer-events-none', avatar?.status !== 'loaded' && 'hidden', className)}
            draggable={false}
            src={src}
            alt={alt}
            onLoad={(event) => {
                setStatus?.('loaded');
                onLoad?.(event);
            }}
            onError={(event) => {
                setStatus?.('error');
                onError?.(event);
            }}
            {...props}
        />
    );
});

const AvatarFallback = React.forwardRef(function AvatarFallback({ className, children, ...props }, ref) {
    const avatar = React.useContext(AvatarContext);

    if (avatar?.status === 'loaded') {
        return null;
    }

    return (
        <div ref={ref} className={cn(' bg-background flex size-full items-center justify-center overflow-hidden rounded-full', className)} {...props}>
            {children ?? (avatar?.bot ? <Bot className="size-[70%] stroke-2" aria-hidden /> : <UserRound className="mt-[25%] size-full stroke-2" aria-hidden />)}
        </div>
    );
});

export { Avatar, AvatarImage, AvatarFallback };
