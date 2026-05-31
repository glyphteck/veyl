import { timestampMs } from './utils/time.js';

export function banUntilMs(ban) {
    if (!ban || typeof ban !== 'object' || Array.isArray(ban) || ban.until == null) {
        return null;
    }
    return timestampMs(ban.until, null);
}

export function activeBan(ban, now = Date.now()) {
    if (!ban || typeof ban !== 'object' || Array.isArray(ban)) {
        return null;
    }

    const untilMs = banUntilMs(ban);
    return untilMs == null || untilMs > now ? ban : null;
}

export function banState(banned, now = Date.now()) {
    const full = activeBan(banned?.full, now);
    const chat = activeBan(banned?.chat, now);
    const avatar = activeBan(banned?.avatar, now);
    return {
        full,
        chat,
        avatar,
        chatBanned: !!(full || chat),
        avatarBanned: !!(full || avatar),
    };
}

export function nextBanRefreshMs(banned, keys = ['full', 'chat'], now = Date.now()) {
    const times = keys
        .map((key) => banUntilMs(banned?.[key]))
        .filter((value) => Number.isFinite(value) && value > now)
        .sort((a, b) => a - b);
    return times[0] ?? null;
}
