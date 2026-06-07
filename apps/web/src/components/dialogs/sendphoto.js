import { useCallback, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { useUser } from '@/components/providers/userprovider';
import { useChat } from '@/components/providers/chatprovider';
import { formatUserDisplay } from '@veyl/shared/profile';
import { prepareFile } from '@/lib/chat/files';
import { toast } from 'sonner';
import { CAMERA_MEDIA_RECIPIENT_MAX } from '@veyl/shared/config';
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
    const { chatBanned } = useUser();
    const { sendAttachmentMany, sendImageMany, selectPeerChat } = useChat();
    const [sending, setSending] = useState(false);

    const media = data?.media || (data?.photo ? { kind: 'photo', uri: data.photo } : null);
    const kind = media?.kind === 'video' ? 'video' : 'photo';
    const photo = kind === 'photo' ? media?.uri : null;

    const handleSend = useCallback(async (selected) => {
        if (!media || !selected.length || sending || chatBanned) return;
        const recipients = selected.slice(0, CAMERA_MEDIA_RECIPIENT_MAX);
        setSending(true);
        close();
        data?.onSent?.();

        try {
            let payload;
            if (kind === 'video') {
                payload = await prepareFile(media.file);
            } else {
                const blob = dataUriToBlob(photo);
                const img = new Image();
                const dims = await new Promise((resolve) => {
                    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
                    img.onerror = () => resolve({});
                    img.src = photo;
                });
                payload = {
                    data: blob,
                    mimeType: 'image/jpeg',
                    size: blob.size,
                    ...(media.name ? { name: media.name } : {}),
                    previewUri: photo,
                    ...dims,
                };
            }
            const targets = recipients.map((peer) => peer.chatPK);
            const results = kind === 'video' ? await sendAttachmentMany(targets, payload) : await sendImageMany(targets, payload);
            const resultByChatPK = new Map(results.map((result) => [result.peerChatPK, result]));

            for (const peer of recipients) {
                const result = resultByChatPK.get(peer.chatPK);
                if (result?.ok) {
                    if (recipients.length === 1) await selectPeerChat(peer.chatPK);
                    toast(`sent ${kind} to ${formatUserDisplay(peer, false)}`, { icon: <CircleCheck /> });
                } else {
                    console.error(`send ${kind} failed:`, result?.error);
                    toast.error(`failed to send to ${formatUserDisplay(peer, false)}`);
                }
            }
        } catch (error) {
            console.error(`send ${kind} failed:`, error);
            for (const peer of recipients) {
                toast.error(`failed to send to ${formatUserDisplay(peer, false)}`);
            }
        }
    }, [chatBanned, close, data, kind, media, photo, selectPeerChat, sendAttachmentMany, sendImageMany, sending]);

    return <Share onShare={handleSend} busy={sending} disabled={chatBanned} maxPeers={CAMERA_MEDIA_RECIPIENT_MAX} />;
}
