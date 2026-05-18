import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../lib/admin.js';
import { isBlocked, isChatBanned, resolveChatActors, shortChatKey } from '../lib/chatroute.js';
import { getPushDocs, pushSecrets, sendPush } from '../lib/push.js';

export const onChatMessage = onDocumentCreated({ document: 'chats/{chatId}/messages/{msgId}', secrets: pushSecrets }, async (event) => {
    const msg = event.data?.data();
    const senderChatPK = typeof msg?.head?.from === 'string' ? msg.head.from : null;
    const actors = await resolveChatActors(event.params.chatId, senderChatPK);

    if (!actors) {
        console.info('push skip: bad pair', {
            chatId: event.params.chatId,
            senderChatPK: !!senderChatPK,
        });
        return;
    }

    const { senderUid, receiverUid, senderChatPK: peerChatPK } = actors;
    if (!receiverUid || senderUid === receiverUid) {
        console.info('push skip: receiver unresolved', {
            chatId: event.params.chatId,
            senderUid: senderUid || null,
            receiverUid: receiverUid || null,
        });
        return;
    }

    const [senderBanned, receiverBanned, receiverBlockedSender, pushDocs, senderProfile, chatSnap] = await Promise.all([
        isChatBanned(senderUid),
        isChatBanned(receiverUid),
        isBlocked(receiverUid, senderUid),
        getPushDocs(receiverUid),
        senderUid ? db.collection('profiles').doc(senderUid).get() : null,
        db.collection('chats').doc(event.params.chatId).get(),
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
    if (chatSnap.data()?.lastMsg?.head?.cid !== msg?.head?.cid) {
        console.info('push skip: non-preview message', {
            chatId: event.params.chatId,
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

    const senderName = senderProfile?.data()?.username || shortChatKey(peerChatPK);
    console.info('push send: chat', {
        chatId: event.params.chatId,
        receiverUid,
        devices: pushDocs.length,
    });
    await sendPush(receiverUid, pushDocs, {
        title: senderName,
        body: 'sent you a message',
        data: {
            type: 'chat',
            chatId: event.params.chatId,
        },
    });
});
