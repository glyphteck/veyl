'use client';

import Image from 'next/image';
import { Loader } from 'lucide-react';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { cn } from '@/lib/classes';
import { imageWidth, stopClick } from '@/lib/chat/messages';
import { getImageAspect, hasText, isPngMsg } from '@veyl/shared/chat/messages';
import { useMsgImage } from '@/lib/chat/useimage';

export default function ImageMessage({ msg, peerChatPK }) {
    const { cloaked } = useCloak();
    const { src, loading, error } = useMsgImage(peerChatPK, msg);
    const aspect = getImageAspect(msg);
    const width = imageWidth(aspect);
    const hasCaption = hasText(msg?.c);
    const barePng = isPngMsg(msg) && !hasCaption;

    return (
        <div className={cn('overflow-hidden rounded-round', barePng ? '' : 'bg-foreground/5 shadow-sm')} style={{ width, maxWidth: '100%' }} onClick={stopClick}>
            {src ? (
                <div className="relative w-full" style={{ aspectRatio: aspect }}>
                    <Image src={src} alt={msg?.c || 'chat image'} className={`object-cover ${cloaked ? 'blur-xl saturate-0' : ''}`} fill sizes={`${width}px`} unoptimized />
                </div>
            ) : (
                <div className="flex items-center justify-center bg-foreground/5" style={{ width: '100%', aspectRatio: aspect }}>
                    {loading ? (
                        <Loader className="size-5 animate-spin text-muted" />
                    ) : (
                        <span className="text-center text-sm text-muted" title={error?.message || undefined}>
                            {error?.stage ? `image failed (${error.stage})` : 'image unavailable'}
                        </span>
                    )}
                </div>
            )}
            {hasCaption ? <p className={`px-3 py-2 text-sm wrap-break-word whitespace-pre-wrap ${cloaked ? 'cloaked' : ''}`}>{msg.c}</p> : null}
        </div>
    );
}
