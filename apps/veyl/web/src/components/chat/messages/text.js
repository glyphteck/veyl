'use client';

import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { splitLinks } from '@glyphteck/shared/chat/messages';
import { bubbleBg } from '@/lib/messages';
import { getEmojiTextInfo } from '@/lib/utils';
import { stopClick } from './utils';

export function EmojiMessage({ text }) {
    const { cloaked } = useCloak();
    const emoji = getEmojiTextInfo(text);
    if (!emoji) return null;

    return (
        <div className="min-w-0 max-w-full bg-transparent" onClick={stopClick}>
            <span className={`block min-w-0 max-w-full wrap-anywhere whitespace-pre-wrap leading-none select-text ${cloaked ? 'cloaked' : ''}`} style={{ fontSize: emoji.size }}>
                {emoji.text}
            </span>
        </div>
    );
}

export function TextBubble({ msg, fromPeer = false, compact = false, singleLine = false, muted = false, allowEmoji = true, className = '', onClick = stopClick }) {
    const { cloaked } = useCloak();
    if (allowEmoji && getEmojiTextInfo(msg?.c) && !compact) {
        return <EmojiMessage text={msg?.c} />;
    }
    const text = typeof msg?.c === 'string' ? msg.c : '';
    const parts = splitLinks(text);

    return (
        <div
            className={`backdrop-blur-sm min-w-0 max-w-full shadow-sm select-text ${bubbleBg(fromPeer)} ${cloaked ? 'cloaked' : ''} ${compact ? 'rounded-[20px] px-2.5 py-1.5' : 'rounded-round px-3 py-1.5'} ${muted ? 'opacity-65' : ''} ${className}`}
            onClick={onClick}
        >
            <p className={`min-w-0 max-w-full ${singleLine ? 'truncate whitespace-nowrap text-[15px]' : 'wrap-anywhere whitespace-pre-wrap'}`}>
                {parts.map((part, index) =>
                    part.t === 'lnk' ? (
                        <a key={`${part.u}:${index}`} href={part.u} target="_blank" rel="noreferrer" className="underline decoration-2 underline-offset-3" onClick={stopClick}>
                            {part.c}
                        </a>
                    ) : (
                        <span key={index}>{part.c}</span>
                    )
                )}
            </p>
        </div>
    );
}

export default function TextMessage({ msg, fromPeer = false }) {
    return <TextBubble msg={msg} fromPeer={fromPeer} />;
}
