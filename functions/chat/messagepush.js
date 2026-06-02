import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { isChatBanned } from '../lib/chatroute.js';
import { getPushDocs, pushSecrets, sendPush } from '../lib/push.js';
import { syncPushRouteForUid } from '../lib/pushroute.js';

export const onChatMessage = onDocumentCreated({ document: 'users/{uid}/chatInbox/{wakeId}', secrets: pushSecrets }, async (event) => {
    const receiverUid = event.params.uid;
    if (!receiverUid) {
        return;
    }

    const [receiverBanned, pushDocs] = await Promise.all([
        isChatBanned(receiverUid),
        getPushDocs(receiverUid),
    ]);
    if (receiverBanned) {
        console.info('push skip: chat banned', { receiverUid });
        return;
    }

    if (!pushDocs.length) {
        await syncPushRouteForUid(receiverUid).catch((error) => {
            console.warn('push route sync failed after empty push lookup', {
                receiverUid,
                error: error?.message || String(error),
            });
        });
        console.info('push skip: no device tokens', { receiverUid });
        return;
    }

    await sendPush(receiverUid, pushDocs, {
        collapseId: `chat-${receiverUid}`,
        title: 'New message',
        body: 'open Veyl to view it',
        data: {
            type: 'chat',
        },
    });
});
