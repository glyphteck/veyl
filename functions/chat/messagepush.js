import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getChatPair, getProfileByChatPK, isBlocked, isChatBanned, messageSenderFallback } from '../lib/chatroute.js';
import { getPushDocs, pushSecrets, sendPush } from '../lib/push.js';
import { getPushRoute, syncPushRouteForUid } from '../lib/pushroute.js';

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

    const pair = getChatPair(event.params.chatId, senderChatPK);

    if (!pair) {
        console.info('push skip: bad pair', {
            chatId: event.params.chatId,
            senderChatPK: !!senderChatPK,
        });
        return;
    }

    const receiverRoute = await getPushRoute(pair.receiverChatPK);
    const receiverUid = receiverRoute?.uid || null;
    if (!receiverUid || receiverRoute.activePushCount <= 0) {
        console.info('push skip: no active push route', {
            chatId: event.params.chatId,
            receiverChatPK: !!pair.receiverChatPK,
            receiverUid,
        });
        return;
    }

    const senderRoute = await getPushRoute(pair.senderChatPK);
    let senderUid = senderRoute?.uid || null;
    let senderName = senderRoute?.username || '';
    let duplicateSenderChatPK = false;
    if (!senderUid || !senderName) {
        const sender = await getProfileByChatPK(pair.senderChatPK);
        duplicateSenderChatPK = sender.duplicate;
        senderUid ||= sender.profile?.uid || null;
        senderName ||= sender.profile?.username || '';
    }

    if (duplicateSenderChatPK || !senderUid || senderUid === receiverUid) {
        console.info('push skip: receiver unresolved', {
            chatId: event.params.chatId,
            duplicateSenderChatPK,
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
        await syncPushRouteForUid(receiverUid).catch((error) => {
            console.warn('push route sync failed after empty push lookup', {
                receiverUid,
                error: error?.message || String(error),
            });
        });
        console.info('push skip: no device tokens', {
            chatId: event.params.chatId,
            receiverUid,
        });
        return;
    }

    console.info('push send: chat', {
        chatId: event.params.chatId,
        receiverUid,
        devices: pushDocs.length,
    });
    await sendPush(receiverUid, pushDocs, {
        collapseId: `chat-${event.params.chatId}`,
        title: senderName || messageSenderFallback(),
        body: 'sent you a message',
        data: {
            type: 'chat',
            chatId: event.params.chatId,
        },
    });
});
