'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { File, Loader, Play } from 'lucide-react';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useChat } from '@/components/providers/chatprovider';
import { useTxData } from '@/components/providers/txdataprovider';
import { useUser } from '@/components/providers/userprovider';
import { bubbleBg, imageWidth } from '@/lib/chat/messages';
import { UNAVAILABLE_REPLY_MSG_TYPE, getAttachmentCaption, getAttachmentTitle, getImageAspect, getRequestContext, isExpiredAttachmentMsg, makeUnavailableReply } from '@veyl/shared/chat/messages';
import { getMessagePreviewCacheKey } from '@veyl/shared/chat/previews';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { useMsgImage } from '@/lib/chat/useimage';
import { getReadyPoster, getVideoCacheKey, loadVideoObjectUrl, loadVideoPoster } from '@/lib/chat/videocache';
import { AudioBubble } from './audio';
import { TextBubble } from './text';

function ReplyButton({ onReplyPress, children }) {
    return (
        <button
            type="button"
            className="block min-w-0 max-w-full border-0 bg-transparent p-0 text-left"
            onClick={(event) => {
                event.stopPropagation();
                onReplyPress?.();
            }}
        >
            {children}
        </button>
    );
}

function ReplyText({ reply, replyFromPeer, onReplyPress }) {
    const { cloaked } = useCloak();

    return (
        <ReplyButton onReplyPress={onReplyPress}>
            <div className={`backdrop-blur-sm min-w-0 max-w-full rounded-full px-2 py-0.5 shadow-sm opacity-65 ${bubbleBg(replyFromPeer)}`}>
                <p className={`truncate whitespace-nowrap text-md ${cloaked ? 'cloaked' : ''}`}>{reply?.c}</p>
            </div>
        </ReplyButton>
    );
}

function ReplyUnavailable({ reply, onReplyPress }) {
    return (
        <ReplyButton onReplyPress={onReplyPress}>
            <div className="min-w-0 max-w-full rounded-full bg-foreground px-2.5 py-1 shadow-sm">
                <p className="truncate whitespace-nowrap text-[15px] font-medium text-background">{reply?.c}</p>
            </div>
        </ReplyButton>
    );
}

function ReplyRequest({ reply, replyFromPeer, peerDisplayName, onReplyPress }) {
    const { settings } = useUser();
    const bitcoin = useBitcoin();
    const { getTxById } = useTxData();
    const { amount, label } = getRequestContext(reply, { fromPeer: replyFromPeer, peerDisplayName, moneyFormat: settings?.moneyFormat, btcPrice: bitcoin?.price, getTxById });

    return (
        <ReplyButton onReplyPress={onReplyPress}>
            <div className={`backdrop-blur-sm min-w-0 max-w-full rounded-[20px] px-3 py-2 shadow-sm opacity-65 ${bubbleBg(replyFromPeer)}`}>
                <p className="truncate text-[11px] font-black text-muted">{label}</p>
                <p className="truncate text-2xl font-black">{amount}</p>
            </div>
        </ReplyButton>
    );
}

function ReplyImage({ reply, peerChatPK, onReplyPress }) {
    const { cloaked } = useCloak();
    const { src, loading, error } = useMsgImage(peerChatPK, reply);
    const aspect = getImageAspect(reply);
    const width = Math.round(Math.min(160, imageWidth(aspect) * 0.56));

    return (
        <ReplyButton onReplyPress={onReplyPress}>
            <div className="overflow-hidden rounded-[20px] bg-foreground/5 shadow-sm opacity-65" style={{ width, maxWidth: '100%' }}>
                {src ? (
                    <div className="relative w-full" style={{ aspectRatio: aspect }}>
                        <Image src={src} alt={reply?.c || 'replied image'} className={`object-cover ${cloaked ? 'blur-xl saturate-0' : ''}`} fill sizes={`${width}px`} unoptimized />
                    </div>
                ) : (
                    <div className="flex items-center justify-center bg-foreground/5" style={{ width: '100%', aspectRatio: aspect }}>
                        {loading ? <Loader className="size-4 animate-spin text-muted" /> : <span className="text-xs text-muted">{error ? 'image unavailable' : 'image'}</span>}
                    </div>
                )}
                {typeof reply?.c === 'string' && reply.c.trim() ? <p className={`truncate px-2.5 py-2 text-sm ${cloaked ? 'cloaked' : ''}`}>{reply.c}</p> : null}
            </div>
        </ReplyButton>
    );
}

function ReplyVideo({ reply, peerChatPK, onReplyPress }) {
    const { readMessageFile, readMessagePreview, writeMessagePreview } = useChat();
    const { cloaked } = useCloak();
    const aspect = getImageAspect(reply, 16 / 9);
    const width = Math.round(Math.min(160, imageWidth(aspect) * 0.56));
    const posterKey = getMessagePreviewCacheKey(peerChatPK, reply) || getVideoCacheKey(peerChatPK, reply);
    const expired = isExpiredAttachmentMsg(reply);
    const localSrc = !expired && typeof reply?.localUri === 'string' && reply.localUri ? reply.localUri : '';
    const [poster, setPoster] = useState(() => (expired ? '' : getReadyPoster(posterKey)));
    const [loading, setLoading] = useState(() => !expired && !!posterKey && !getReadyPoster(posterKey));
    const caption = getAttachmentCaption(reply);

    useEffect(() => {
        if (expired || !posterKey) {
            setPoster('');
            setLoading(false);
            return;
        }

        const cachedPoster = getReadyPoster(posterKey);
        if (cachedPoster) {
            setPoster(cachedPoster);
            setLoading(false);
            return;
        }

        let cancelled = false;
        setPoster('');
        setLoading(true);

        const task = async () => {
            const src = localSrc || (await loadVideoObjectUrl(peerChatPK, reply, readMessageFile, { priority: 1 }).catch(() => ''));
            const nextPoster = getReadyPoster(posterKey) || (await loadVideoPoster(posterKey, src, reply, readMessagePreview, writeMessagePreview, { priority: 1 }).catch(() => ''));
            if (cancelled) {
                return;
            }
            setPoster(nextPoster || '');
            setLoading(false);
        };

        task().catch(() => {
            if (!cancelled) {
                setPoster('');
                setLoading(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [expired, localSrc, peerChatPK, posterKey, readMessageFile, readMessagePreview, reply, writeMessagePreview]);

    return (
        <ReplyButton onReplyPress={onReplyPress}>
            <div className="overflow-hidden rounded-[20px] bg-foreground/5 shadow-sm opacity-65" style={{ width, maxWidth: '100%' }}>
                <div className="relative bg-foreground/5" style={{ width: '100%', aspectRatio: aspect }}>
                    {poster ? (
                        <Image src={poster} alt={reply?.c || 'replied video'} className={`object-cover ${cloaked ? 'blur-xl saturate-0' : ''}`} fill sizes={`${width}px`} unoptimized />
                    ) : (
                        <div className="flex size-full items-center justify-center">{loading ? <Loader className="size-4 animate-spin text-muted" /> : null}</div>
                    )}
                    {!loading ? (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
                            <span className="flex size-10 items-center justify-center rounded-full bg-black/35" style={{ WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)' }}>
                                <Play className="size-5 fill-current stroke-0" />
                            </span>
                        </div>
                    ) : null}
                </div>
                {caption ? <p className={`truncate px-2.5 py-2 text-sm ${cloaked ? 'cloaked' : ''}`}>{caption}</p> : null}
            </div>
        </ReplyButton>
    );
}

function ReplyAttachment({ reply, replyFromPeer, onReplyPress }) {
    const { cloaked } = useCloak();
    const title = getAttachmentTitle(reply);
    const caption = getAttachmentCaption(reply);

    return (
        <ReplyButton onReplyPress={onReplyPress}>
            <div className={`flex min-w-0 max-w-full items-center gap-3 rounded-[20px] px-3 py-2 shadow-sm opacity-65 ${bubbleBg(replyFromPeer)}`}>
                <File className="size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-black ${cloaked ? 'cloaked' : ''}`}>{title}</p>
                    {caption ? <p className={`truncate text-xs ${cloaked ? 'cloaked' : ''}`}>{caption}</p> : null}
                </div>
            </div>
        </ReplyButton>
    );
}

function ReplyAudio({ reply, replyFromPeer, onReplyPress }) {
    return (
        <ReplyButton onReplyPress={onReplyPress}>
            <AudioBubble msg={reply} fromPeer={replyFromPeer} disabled inactive compact />
        </ReplyButton>
    );
}

function ReplyPreview({ reply, replyFromPeer, peerChatPK, peerDisplayName, onReplyPress }) {
    switch (reply?.t) {
        case UNAVAILABLE_REPLY_MSG_TYPE:
            return <ReplyUnavailable reply={reply} onReplyPress={onReplyPress} />;
        case 'txt':
            return <ReplyText reply={reply} replyFromPeer={replyFromPeer} onReplyPress={onReplyPress} />;
        case 'req':
            return <ReplyRequest reply={reply} replyFromPeer={replyFromPeer} peerDisplayName={peerDisplayName} onReplyPress={onReplyPress} />;
        case 'img':
            return <ReplyImage reply={reply} peerChatPK={peerChatPK} onReplyPress={onReplyPress} />;
        case 'mp4':
            return <ReplyVideo reply={reply} peerChatPK={peerChatPK} onReplyPress={onReplyPress} />;
        case 'm4a':
            return <ReplyAudio reply={reply} replyFromPeer={replyFromPeer} onReplyPress={onReplyPress} />;
        case 'file':
            return <ReplyAttachment reply={reply} replyFromPeer={replyFromPeer} onReplyPress={onReplyPress} />;
        default:
            return null;
    }
}

export default function ReplyMessage({ msg, fromPeer = false, reply, replyFromPeer = false, peerChatPK, peerDisplayName, onReplyPress }) {
    const body = <TextBubble msg={msg} fromPeer={fromPeer} allowEmoji={false} />;
    const replyPreview = reply || (msg?.r ? makeUnavailableReply() : null);

    if (!replyPreview) {
        return body;
    }

    return (
        <div className={`flex min-w-0 max-w-full flex-col gap-1.5 ${fromPeer ? 'items-start' : 'items-end'}`}>
            <ReplyPreview reply={replyPreview} replyFromPeer={replyFromPeer} peerChatPK={peerChatPK} peerDisplayName={peerDisplayName} onReplyPress={onReplyPress} />
            <div className="min-w-0 max-w-full">
                {body}
            </div>
        </div>
    );
}
