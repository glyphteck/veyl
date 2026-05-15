import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { FieldValue, db } from '../lib/admin.js';
import { isBlocked, isChatBanned, resolveChatActors, shortChatKey } from '../lib/chatroute.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;

function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) {
        out.push(list.slice(i, i + size));
    }
    return out;
}

async function getPushDocs(uid) {
    const snap = await db.collection('users').doc(uid).collection('push').get();
    return snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((item) => item.enabled !== false && typeof item.token === 'string' && item.token);
}

async function markDead(uid, docs) {
    const validDocs = docs.filter((item) => item?.id);
    if (!uid || !validDocs.length) {
        return;
    }

    const batch = db.batch();
    validDocs.forEach((item) => {
        batch.set(
            db.collection('users').doc(uid).collection('push').doc(item.id),
            {
                enabled: false,
                lastError: 'DeviceNotRegistered',
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
    });
    await batch.commit();
}

async function sendPush(uid, docs, body) {
    const stale = [];

    for (const group of chunk(docs, CHUNK)) {
        const payload = group.map((item) => ({
            to: item.token,
            sound: 'default',
            title: body.title,
            body: body.body,
            data: body.data,
        }));

        const res = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'accept-encoding': 'gzip, deflate',
                'content-type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`expo push failed (${res.status}): ${text}`);
        }

        const json = await res.json();
        if (Array.isArray(json?.errors) && json.errors.length) {
            throw new Error(`expo push request error: ${JSON.stringify(json.errors[0])}`);
        }
        const data = Array.isArray(json?.data) ? json.data : [];
        console.info('push expo tickets', {
            uid,
            sent: group.length,
            ok: data.filter((ticket) => ticket?.status === 'ok').length,
            errors: data.filter((ticket) => ticket?.status === 'error').map((ticket) => ticket?.details?.error || 'unknown'),
        });

        data.forEach((ticket, index) => {
            if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered' && group[index]) {
                stale.push(group[index]);
            }
        });
    }

    if (stale.length) {
        await markDead(uid, stale);
    }
}

export const onChatMessage = onDocumentCreated('chats/{chatId}/messages/{msgId}', async (event) => {
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
