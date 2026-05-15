import { useCallback, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { useUser } from '@/components/providers/userprovider';
import { useChat } from '@/components/providers/chatprovider';
import { canShareAttachmentMsg, getAttachmentTitle } from '@glyphteck/shared/chat/messages';
import { getChatId } from '@glyphteck/shared/crypto/chat';
import { formatUserDisplay } from '@/lib/utils';
import { toast } from 'sonner';
import Share from './share';

export default function ShareMedia({ data, close }) {
    const { chatPK, chatBanned } = useUser();
    const { shareAttachment, selectChat } = useChat();
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
                const chatId = getChatId(chatPK, peer.chatPK);
                if (selected.length === 1) selectChat(chatId);
                toast(`sent ${getAttachmentTitle(msg)} to ${formatUserDisplay(peer, false)}`, { icon: <CircleCheck /> });
            } catch (error) {
                console.error('share media failed:', error);
                toast.error(`failed to send to ${formatUserDisplay(peer, false)}`);
            }
        }
    }, [canShare, chatBanned, chatPK, close, msg, selectChat, sending, shareAttachment]);

    return <Share onShare={handleSend} busy={sending} disabled={!canShare || chatBanned} />;
}
