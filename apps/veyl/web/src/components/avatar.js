'use client';

import * as React from 'react';
import Image from 'next/image';
import { Bot, UserRound } from 'lucide-react';
import { avatarSourceKey } from '@veyl/shared/avatar';

import { cn } from '@/lib/classes';
import { Dot } from '@/components/dot';

const AvatarContext = React.createContext(null);
const loadedAvatarSrcs = new Set();

function getAvatarImageKey(src) {
    return avatarSourceKey(src);
}

function isAvatarImageLoaded(src) {
    const srcKey = getAvatarImageKey(src);
    return !!srcKey && loadedAvatarSrcs.has(srcKey);
}

const Avatar = React.forwardRef(function Avatar({ className, active = false, selected = null, bot = false, children, ...props }, ref) {
    const [imageState, setImageState] = React.useState({ status: 'idle', srcKey: '' });
    const setStatus = React.useCallback((status, srcKey = '') => {
        setImageState((current) => (current.status === status && current.srcKey === srcKey ? current : { status, srcKey }));
    }, []);
    const selectable = selected != null;

    return (
        <AvatarContext.Provider value={{ status: imageState.status, srcKey: imageState.srcKey, setStatus, bot }}>
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
    const loaded = avatar?.status === 'loaded' && avatar?.srcKey === srcKey;

    React.useEffect(() => {
        if (!srcKey) {
            setStatus?.('error', srcKey);
            return;
        }
        if (loadedAvatarSrcs.has(srcKey)) {
            setStatus?.('loaded', srcKey);
            return;
        }

        const img = imgRef.current;
        if (img?.complete) {
            if (img.naturalWidth > 0) {
                loadedAvatarSrcs.add(srcKey);
                setStatus?.('loaded', srcKey);
            } else {
                setStatus?.('error', srcKey);
            }
            return;
        }

        setStatus?.('loading', srcKey);
    }, [setStatus, srcKey]);

    if (!srcKey) {
        return null;
    }

    return (
        <Image
            alt={alt}
            ref={(node) => {
                imgRef.current = node;
                if (typeof ref === 'function') {
                    ref(node);
                } else if (ref) {
                    ref.current = node;
                }
            }}
            className={cn('pointer-events-none absolute inset-0 size-full select-none object-cover transition-opacity duration-200 ease-out', loaded ? 'opacity-100' : 'opacity-0', className)}
            draggable={false}
            height={40}
            src={srcKey}
            unoptimized
            width={40}
            onLoad={(event) => {
                loadedAvatarSrcs.add(srcKey);
                setStatus?.('loaded', srcKey);
                onLoad?.(event);
            }}
            onError={(event) => {
                setStatus?.('error', srcKey);
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
            <span className={cn('absolute inset-0 flex items-center justify-center transition-opacity duration-200 ease-out', loaded ? 'opacity-0' : 'opacity-100')} aria-hidden>
                {fallback}
            </span>
            <Image
                alt=""
                aria-hidden="true"
                className="absolute inset-0 size-full object-cover transition-opacity duration-200 ease-out"
                draggable={false}
                height={40}
                src={srcKey}
                style={{ opacity: loaded ? 1 : 0 }}
                unoptimized
                width={40}
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
    const hidden = avatar?.status === 'loaded';

    return (
        <div ref={ref} className={cn('pointer-events-none absolute inset-0 flex size-full items-center justify-center overflow-hidden rounded-full bg-background transition-opacity duration-200 ease-out', hidden ? 'opacity-0' : 'opacity-100', className)} {...props}>
            {children ?? (avatar?.bot ? <Bot className="size-[70%] stroke-2" aria-hidden /> : <UserRound className="mt-[25%] size-full stroke-2" aria-hidden />)}
        </div>
    );
});

export { Avatar, AvatarImage, AvatarFallback, StaticAvatar, isAvatarImageLoaded };
