'use client';

import { useCallback, useState } from 'react';
import { File, Loader } from 'lucide-react';
import { useChat } from '@/components/providers/chatprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { attachmentMeta, bubbleBg, saveMsgFile } from '@/lib/messages';
import { getAttachmentCaption, getAttachmentTitle } from '@glyphteck/shared/chat/messages';
import { stopClick } from './utils';

export default function AttachmentMessage({ msg, peerChatPK, fromPeer = false }) {
    const { readMessageFile } = useChat();
    const { cloaked } = useCloak();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const title = getAttachmentTitle(msg);
    const caption = getAttachmentCaption(msg);
    const canDownload = !!peerChatPK && !!msg?.p && !!msg?.k && !loading;

    const handleDownload = useCallback(
        async (event) => {
            stopClick(event);
            if (!canDownload) {
                return;
            }

            setLoading(true);
            setError('');

            try {
                await saveMsgFile(readMessageFile, peerChatPK, msg);
            } catch (nextError) {
                console.warn('chat attachment download failed', nextError);
                setError(nextError?.message || 'download failed');
            } finally {
                setLoading(false);
            }
        },
        [canDownload, msg, peerChatPK, readMessageFile]
    );

    return (
        <button
            type="button"
            className={`shrinker flex min-w-0 max-w-full flex-col gap-3 rounded-round ${bubbleBg(fromPeer)} pl-4 pr-6 py-3 text-left shadow-sm ${canDownload ? 'cursor-pointer' : 'cursor-default'}`}
            onClick={handleDownload}
            disabled={!canDownload}
        >
            <div className="flex min-w-0 items-center gap-4">
                {loading ? <Loader className="size-6 shrink-0 animate-spin" /> : <File className="size-6 shrink-0" />}
                <div className="min-w-0 flex-1 overflow-hidden">
                    <p className={`block truncate font-black ${cloaked ? 'cloaked' : ''}`}>{title}</p>
                    <p className="text-sm text-muted">{attachmentMeta(msg, loading, error)}</p>
                </div>
            </div>
            {caption ? <p className={`wrap-break-word whitespace-pre-wrap text-sm ${cloaked ? 'cloaked' : ''}`}>{caption}</p> : null}
        </button>
    );
}
