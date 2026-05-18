'use client';

import * as React from 'react';
import { Bot, UserRound } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Dot } from '@/components/dot';

const AvatarContext = React.createContext(null);
const loadedAvatarSrcs = new Set();

function getAvatarImageKey(src) {
    return typeof src === 'string' ? src.trim() : '';
}

function isAvatarImageLoaded(src) {
    const srcKey = getAvatarImageKey(src);
    return !!srcKey && loadedAvatarSrcs.has(srcKey);
}

const Avatar = React.forwardRef(function Avatar({ className, active = false, selected = null, bot = false, children, ...props }, ref) {
    const [status, setStatus] = React.useState('idle');
    const selectable = selected != null;

    return (
        <AvatarContext.Provider value={{ status, setStatus, bot }}>
            <div ref={ref} className={cn('avatar shadow-sm relative flex size-10 shrink-0 overflow-visible rounded-full', className)} {...props}>
                <Dot show={active} type="active" vectorMask className="size-full" maskTargetClassName="relative size-full overflow-hidden rounded-full">
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
    const srcKey = getAvatarImageKey(src);

    React.useEffect(() => {
        if (!srcKey) {
            setStatus?.('error');
            return;
        }
        if (loadedAvatarSrcs.has(srcKey)) {
            setStatus?.('loaded');
            return;
        }

        const img = imgRef.current;
        if (img?.complete) {
            if (img.naturalWidth > 0) {
                loadedAvatarSrcs.add(srcKey);
                setStatus?.('loaded');
            } else {
                setStatus?.('error');
            }
            return;
        }

        setStatus?.('loading');
    }, [setStatus, srcKey]);

    if (!srcKey) {
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
                loadedAvatarSrcs.add(srcKey);
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

const StaticAvatar = React.forwardRef(function StaticAvatar({ className, src, style, bot = false, ...props }, ref) {
    const srcKey = getAvatarImageKey(src);
    const [loaded, setLoaded] = React.useState(() => isAvatarImageLoaded(srcKey));

    React.useEffect(() => {
        setLoaded(isAvatarImageLoaded(srcKey));
    }, [srcKey]);

    const fallback = bot ? <Bot className="size-[70%] stroke-2" aria-hidden /> : <UserRound className="mt-[25%] size-full stroke-2" aria-hidden />;

    if (!srcKey) {
        return (
            <span ref={ref} className={cn('flex size-full items-center justify-center overflow-hidden rounded-full bg-background', className)} style={style} {...props}>
                {fallback}
            </span>
        );
    }

    return (
        <span ref={ref} className={cn('relative flex size-full items-center justify-center overflow-hidden rounded-full bg-background', className)} style={style} {...props}>
            {!loaded ? fallback : null}
            <img
                alt=""
                aria-hidden="true"
                className="absolute inset-0 size-full object-cover"
                draggable={false}
                src={srcKey}
                style={{ opacity: loaded ? 1 : 0 }}
                onLoad={() => {
                    loadedAvatarSrcs.add(srcKey);
                    setLoaded(true);
                }}
                onError={() => {
                    setLoaded(false);
                }}
            />
        </span>
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

export { Avatar, AvatarImage, AvatarFallback, StaticAvatar, isAvatarImageLoaded };
