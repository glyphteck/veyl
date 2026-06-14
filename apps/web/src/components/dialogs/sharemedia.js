import { useCallback, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { useUser } from '@/components/providers/userprovider';
import { useChat } from '@/components/providers/chatprovider';
import { readCachedShareAttachmentData } from '@/lib/chat/share';
import { canShareAttachmentMsg, getAttachmentTitle } from '@veyl/shared/chat/messages';
import { formatUserDisplay } from '@veyl/shared/profile';
import { toast } from '@/components/notifications';
import Share from './share';

export default function ShareMedia({ data, close }) {
    const { chatBanned } = useUser();
    const { share, selectPeerChat } = useChat();
    const [sending, setSending] = useState(false);
    const msg = data?.msg;
    const sourcePeerChatPK = data?.sourcePeerChatPK;
    const canShare = canShareAttachmentMsg(msg);

    const handleSend = useCallback(async (selected) => {
        if (!canShare || !selected.length || sending || chatBanned) return;
        setSending(true);
        close();

        const shareData = await readCachedShareAttachmentData(msg, sourcePeerChatPK).catch(() => null);
        const results = await share(selected.map((peer) => peer.chatPK), msg, { sourcePeerChatPK, data: shareData });
        for (const [index, peer] of selected.entries()) {
            try {
                const result = results[index];
                if (result?.ok === false) {
                    throw result.error || new Error('share failed');
                }
                if (selected.length === 1) await selectPeerChat(peer.chatPK);
                toast(`sent ${getAttachmentTitle(msg)} to ${formatUserDisplay(peer, false)}`, { icon: <CircleCheck /> });
            } catch (error) {
                console.error('share media failed:', error);
                toast.error(`failed to send to ${formatUserDisplay(peer, false)}`);
            }
        }
    }, [canShare, chatBanned, close, msg, selectPeerChat, sending, share, sourcePeerChatPK]);

    return <Share onShare={handleSend} busy={sending} disabled={!canShare || chatBanned} />;
}
