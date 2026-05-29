import { db } from './admin.js';

export function messageSenderFallback() {
    return 'someone';
}

export function getChatPair(chatId, senderChatPK) {
    const sender = String(senderChatPK ?? '')
        .trim()
        .toLowerCase();
    const parts = String(chatId ?? '')
        .split('_')
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);

    if (parts.length !== 2) {
        return null;
    }

    const receiverChatPK = parts[0] === sender ? parts[1] : parts[1] === sender ? parts[0] : null;
    if (!receiverChatPK) {
        return null;
    }

    return { senderChatPK: sender, receiverChatPK };
}

async function getProfileByChatPK(chatPK) {
    const snap = await db.collection('profiles').where('chatPK', '==', chatPK).limit(2).get();
    if (snap.docs.length !== 1) {
        return {
            duplicate: snap.docs.length > 1,
            profile: null,
        };
    }

    const profileSnap = snap.docs[0];
    return {
        duplicate: false,
        profile: { uid: profileSnap.id, ...profileSnap.data() },
    };
}

export async function resolveChatActors(chatId, senderChatPK) {
    const pair = getChatPair(chatId, senderChatPK);
    if (!pair) {
        return null;
    }

    const [sender, receiver] = await Promise.all([getProfileByChatPK(pair.senderChatPK), getProfileByChatPK(pair.receiverChatPK)]);
    const senderProfile = sender.profile;
    const receiverProfile = receiver.profile;
    return {
        ...pair,
        duplicateChatPKs: [sender.duplicate ? pair.senderChatPK : null, receiver.duplicate ? pair.receiverChatPK : null].filter(Boolean),
        senderProfile,
        receiverProfile,
        senderUid: senderProfile?.uid || null,
        receiverUid: receiverProfile?.uid || null,
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
