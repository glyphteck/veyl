import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { isBlocked, isChatBanned, messageSenderFallback, resolveChatActors } from '../lib/chatroute.js';
import { getPushDocs, pushSecrets, sendPush } from '../lib/push.js';

function lastCid(snap) {
    const cid = snap?.data?.()?.lastMsg?.head?.cid;
    return typeof cid === 'string' ? cid : null;
}

export const onChatMessage = onDocumentWritten({ document: 'chats/{chatId}', secrets: pushSecrets }, async (event) => {
    const chat = event.data?.after?.data();
    if (!chat) {
        return;
    }

    const msg = chat.lastMsg;
    const senderChatPK = typeof msg?.head?.from === 'string' ? msg.head.from : null;
    const cid = typeof msg?.head?.cid === 'string' ? msg.head.cid : null;
    if (!senderChatPK || !cid || cid === lastCid(event.data?.before)) {
        return;
    }

    const actors = await resolveChatActors(event.params.chatId, senderChatPK);

    if (!actors) {
        console.info('push skip: bad pair', {
            chatId: event.params.chatId,
            senderChatPK: !!senderChatPK,
        });
        return;
    }

    const { duplicateChatPKs, senderUid, receiverUid } = actors;
    if (duplicateChatPKs.length || !receiverUid || senderUid === receiverUid) {
        console.info('push skip: receiver unresolved', {
            chatId: event.params.chatId,
            duplicateChatPKs: duplicateChatPKs.length,
            senderUid: senderUid || null,
            receiverUid: receiverUid || null,
        });
        return;
    }

    const [senderBanned, receiverBanned, receiverBlockedSender, pushDocs] = await Promise.all([
        isChatBanned(senderUid),
        isChatBanned(receiverUid),
        isBlocked(receiverUid, senderUid),
        getPushDocs(receiverUid),
    ]);
    if (senderBanned || receiverBanned) {
        console.info('push skip: chat banned', {
            chatId: event.params.chatId,
            senderUid,
            receiverUid,
            senderBanned,
            receiverBanned,
        });
        return;
    }
    if (receiverBlockedSender) {
        console.info('push skip: receiver blocked sender', {
            chatId: event.params.chatId,
            senderUid,
            receiverUid,
        });
        return;
    }

    if (!pushDocs.length) {
        console.info('push skip: no device tokens', {
            chatId: event.params.chatId,
            receiverUid,
        });
        return;
    }

    const senderName = actors.senderProfile?.username || messageSenderFallback();
    console.info('push send: chat', {
        chatId: event.params.chatId,
        receiverUid,
        devices: pushDocs.length,
    });
    await sendPush(receiverUid, pushDocs, {
        collapseId: `chat-${event.params.chatId}`,
        title: senderName,
        body: 'sent you a message',
        data: {
            type: 'chat',
            chatId: event.params.chatId,
        },
    });
});
