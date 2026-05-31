import { readAvatarVersion } from './avatar.js';
import { truncateAddress } from './utils/display.js';
import { cleanText } from './utils/text.js';

export function hasPeerKeys(profile) {
    return !!(profile?.walletPK || profile?.chatPK);
}

export function peerUid(peer) {
    return typeof peer === 'string' ? cleanText(peer) : cleanText(peer?.uid);
}

export function peerKey(peer, fallback = '') {
    if (typeof peer === 'string') {
        return cleanText(peer) || fallback;
    }
    return cleanText(peer?.uid) || cleanText(peer?.chatPK) || cleanText(peer?.walletPK) || fallback;
}

export function isFullProfile(profile) {
    return !!(profile?.uid && ('active' in profile || 'username' in profile || ('walletPK' in profile && 'chatPK' in profile)));
}

export function normalizeProfile(profile, uid = profile?.uid || null) {
    return {
        username: profile?.username || null,
        avatar: profile?.avatar || null,
        walletPK: profile?.walletPK || null,
        chatPK: profile?.chatPK || null,
        active: profile?.active ?? false,
        bot: profile?.bot || null,
        avatarVersion: readAvatarVersion(profile?.avatarVersion),
        uid,
    };
}

export function formatUserDisplay(user, showAtSymbol = false) {
    if (!user) {
        return 'unknown user';
    }
    if (user.username) {
        if (showAtSymbol) {
            return `@${user.username}`;
        }
        return user.username;
    }
    if (user.walletPK) {
        return truncateAddress(user.walletPK);
    }
    if (user.chatPK) {
        return truncateAddress(user.chatPK);
    }
    return 'unknown user';
}
