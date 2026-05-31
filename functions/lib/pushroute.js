import { db, FieldValue } from './admin.js';

const MAX_PUSH_DOCS_PER_USER = 4;
const CHAT_PK_RE = /^[0-9a-f]{64}$/;

function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function cleanChatPK(value) {
    const chatPK = cleanText(value).toLowerCase();
    return CHAT_PK_RE.test(chatPK) ? chatPK : '';
}

function activePushDoc(data) {
    return data?.enabled !== false && (cleanText(data?.nativeToken) || cleanText(data?.token));
}

export function cleanPushRoute(data) {
    const uid = cleanText(data?.uid);
    const chatPK = cleanChatPK(data?.chatPK);
    const username = cleanText(data?.username).toLowerCase();
    const activePushCount = Math.max(0, Math.floor(Number(data?.activePushCount) || 0));
    return uid && chatPK
        ? {
              uid,
              chatPK,
              username,
              activePushCount,
          }
        : null;
}

export async function getPushRoute(chatPK) {
    const routeChatPK = cleanChatPK(chatPK);
    if (!routeChatPK) {
        return null;
    }
    const snap = await db.collection('pushRoutes').doc(routeChatPK).get();
    return snap.exists ? cleanPushRoute({ chatPK: snap.id, ...snap.data() }) : null;
}

export async function syncPushRouteForUid(uid) {
    const cleanUid = cleanText(uid);
    if (!cleanUid) {
        return null;
    }

    const [profileSnap, pushSnap] = await Promise.all([
        db.collection('profiles').doc(cleanUid).get(),
        db.collection('users').doc(cleanUid).collection('push').orderBy('updatedAt', 'desc').limit(MAX_PUSH_DOCS_PER_USER).get(),
    ]);
    const profile = profileSnap.exists ? profileSnap.data() : null;
    const chatPK = cleanChatPK(profile?.chatPK);
    if (!chatPK) {
        return null;
    }

    const activePushCount = pushSnap.docs.filter((docSnap) => activePushDoc(docSnap.data())).length;
    const route = {
        uid: cleanUid,
        chatPK,
        username: cleanText(profile?.username).toLowerCase(),
        activePushCount,
        updatedAt: FieldValue.serverTimestamp(),
    };
    await db.collection('pushRoutes').doc(chatPK).set(route, { merge: true });
    return route;
}
