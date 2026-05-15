'use client';

import { Loader } from 'lucide-react';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { cn } from '@/lib/utils';
import { imageWidth } from '@/lib/messages';
import { getImageAspect } from '@glyphteck/shared/chat/messages';
import { useMsgImage } from '../usemsgimage';
import { stopClick } from './utils';

export default function ImageMessage({ msg, peerChatPK }) {
    const { cloaked } = useCloak();
    const { src, loading, error } = useMsgImage(peerChatPK, msg);
    const aspect = getImageAspect(msg);
    const width = imageWidth(aspect);
    const hasCaption = typeof msg?.c === 'string' && msg.c.trim();
    const barePng = String(msg?.m || '').toLowerCase() === 'image/png' && !hasCaption;

    return (
        <div className={cn('overflow-hidden rounded-round', barePng ? '' : 'bg-foreground/5 shadow-sm')} style={{ width, maxWidth: '100%' }} onClick={stopClick}>
            {src ? (
                <img src={src} alt={msg?.c || 'chat image'} className={`block w-full object-cover ${cloaked ? 'blur-xl saturate-0' : ''}`} style={{ aspectRatio: aspect }} />
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
