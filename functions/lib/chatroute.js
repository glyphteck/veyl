import { db } from './admin.js';
import { getUidByChatPK } from './chatkeys.js';

export function shortChatKey(chatPK) {
    if (!chatPK || typeof chatPK !== 'string') {
        return 'new message';
    }

    if (chatPK.length <= 8) {
        return chatPK;
    }

    return `${chatPK.slice(0, 4)}...${chatPK.slice(-4)}`;
}

export function getChatPair(chatId, senderChatPK) {
    const parts = String(chatId ?? '')
        .split('_')
        .filter(Boolean);

    if (parts.length !== 2) {
        return null;
    }

    const receiverChatPK = parts[0] === senderChatPK ? parts[1] : parts[1] === senderChatPK ? parts[0] : null;
    if (!receiverChatPK) {
        return null;
    }

    return { senderChatPK, receiverChatPK };
}

export async function resolveChatActors(chatId, senderChatPK) {
    const pair = getChatPair(chatId, senderChatPK);
    if (!pair) {
        return null;
    }

    const [senderUid, receiverUid] = await Promise.all([getUidByChatPK(pair.senderChatPK), getUidByChatPK(pair.receiverChatPK)]);
    return {
        ...pair,
        senderUid,
        receiverUid,
    };
}

export async function isBlocked(uid, peerUid) {
    if (!uid || !peerUid) {
        return false;
    }

    const snap = await db.collection('users').doc(uid).collection('blocked').doc(peerUid).get();
    return snap.exists;
}

export async function isChatBanned(uid) {
    if (!uid) {
        return false;
    }

    const snap = await db.collection('moderation').doc(uid).get();
    const banned = snap.data()?.banned;
    const activeBan = banned?.full || banned?.chat;
    if (!activeBan || typeof activeBan !== 'object') {
        return false;
    }

    if (activeBan.until == null) {
        return true;
    }

    const untilMs = typeof activeBan.until?.toMillis === 'function' ? activeBan.until.toMillis() : Number(activeBan.until);
    return Number.isFinite(untilMs) && untilMs > Date.now();
}
