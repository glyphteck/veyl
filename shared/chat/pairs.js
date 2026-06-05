import { CHAT_PAIR_CACHE_LIMIT } from '../config.js';
import { closeChatPair, openChatPair } from '../crypto/chat.js';
import { orderChatKeys } from '../crypto/pair.js';
import { cleanText } from '../utils/text.js';

const pairCache = new Map();
const MAX_PAIR_CACHE = CHAT_PAIR_CACHE_LIMIT;

function getChatPairKey(chatPK, peerChatPK, chatId = '') {
    if (!chatPK || !peerChatPK) return null;
    return `${orderChatKeys(chatPK, peerChatPK).join('|')}|${cleanText(chatId)}`;
}

export function clearChatPairCache() {
    for (const pair of pairCache.values()) {
        closeChatPair(pair);
    }
    pairCache.clear();
}

export async function getCachedPair(chatPK, chatPrivKey, peerChatPK, options = {}) {
    const chatId = cleanText(options?.chatId);
    const key = getChatPairKey(chatPK, peerChatPK, chatId);
    if (!key) {
        return openChatPair(chatPK, chatPrivKey, peerChatPK, { chatId });
    }

    const cached = pairCache.get(key);
    if (cached) return cached;
    const pair = await openChatPair(chatPK, chatPrivKey, peerChatPK, { chatId });
    pairCache.set(key, pair);
    if (pairCache.size > MAX_PAIR_CACHE) {
        const firstKey = pairCache.keys().next().value;
        if (firstKey) {
            closeChatPair(pairCache.get(firstKey));
            pairCache.delete(firstKey);
        }
    }
    return pair;
}

export async function resolveLinkId(chatPK, chatPrivKey, peerChatPK) {
    const pair = await getCachedPair(chatPK, chatPrivKey, peerChatPK);
    return pair?.linkId || null;
}
