import { useCallback, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { useUser } from '@/components/providers/userprovider';
import { useChat } from '@/components/providers/chatprovider';
import { canShareAttachmentMsg, getAttachmentTitle } from '@veyl/shared/chat/messages';
import { formatUserDisplay } from '@veyl/shared/profile';
import { toast } from 'sonner';
import Share from './share';

export default function ShareMedia({ data, close }) {
    const { chatBanned } = useUser();
    const { shareAttachment, selectPeerChat } = useChat();
    const [sending, setSending] = useState(false);
    const msg = data?.msg;
    const canShare = canShareAttachmentMsg(msg);

    const handleSend = useCallback(async (selected) => {
        if (!canShare || !selected.length || sending || chatBanned) return;
        setSending(true);
        close();

        for (const peer of selected) {
            try {
                await shareAttachment(peer.chatPK, msg);
                if (selected.length === 1) await selectPeerChat(peer.chatPK);
                toast(`sent ${getAttachmentTitle(msg)} to ${formatUserDisplay(peer, false)}`, { icon: <CircleCheck /> });
            } catch (error) {
                console.error('share media failed:', error);
                toast.error(`failed to send to ${formatUserDisplay(peer, false)}`);
            }
        }
    }, [canShare, chatBanned, close, msg, selectPeerChat, sending, shareAttachment]);

    return <Share onShare={handleSend} busy={sending} disabled={!canShare || chatBanned} />;
}
