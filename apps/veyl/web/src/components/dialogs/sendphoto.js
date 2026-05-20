import { useCallback, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { useUser } from '@/components/providers/userprovider';
import { useChat } from '@/components/providers/chatprovider';
import { getChatId } from '@glyphteck/shared/crypto/chat';
import { formatUserDisplay } from '@/lib/utils';
import { toast } from 'sonner';
import Share from './share';

function dataUriToBlob(dataUri) {
    const [header, b64] = dataUri.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bytes = atob(b64);
    const buf = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    return new Blob([buf], { type: mime });
}

export default function SendPhoto({ data, close }) {
    const { chatPK, chatBanned } = useUser();
    const { sendImageMany, selectChat } = useChat();
    const [sending, setSending] = useState(false);

    const photo = data?.photo;

    const handleSend = useCallback(async (selected) => {
        if (!photo || !selected.length || sending || chatBanned) return;
        setSending(true);
        close();
        data?.onSent?.();

        const blob = dataUriToBlob(photo);
        const img = new Image();
        const dims = await new Promise((resolve) => {
            img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => resolve({});
            img.src = photo;
        });

        let results;
        try {
            results = await sendImageMany(
                selected.map((peer) => peer.chatPK),
                {
                    data: blob,
                    mimeType: 'image/jpeg',
                    size: blob.size,
                    previewUri: photo,
                    ...dims,
                }
            );
        } catch (error) {
            console.error('send photo failed:', error);
            for (const peer of selected) {
                toast.error(`failed to send to ${formatUserDisplay(peer, false)}`);
            }
            return;
        }
        const resultByChatPK = new Map(results.map((result) => [result.peerChatPK, result]));

        for (const peer of selected) {
            const result = resultByChatPK.get(peer.chatPK);
            if (result?.ok) {
                const chatId = getChatId(chatPK, peer.chatPK);
                if (selected.length === 1) selectChat(chatId);
                toast(`sent photo to ${formatUserDisplay(peer, false)}`, { icon: <CircleCheck /> });
            } else {
                console.error('send photo failed:', result?.error);
                toast.error(`failed to send to ${formatUserDisplay(peer, false)}`);
            }
        }
    }, [chatBanned, chatPK, close, photo, selectChat, sendImageMany, sending]);

    return <Share onShare={handleSend} busy={sending} disabled={chatBanned} />;
}
