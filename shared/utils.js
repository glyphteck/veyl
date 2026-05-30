import { formatMoney } from './formatmoney.js';

const emojiPart =
    '(?:\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|(?:\\p{Emoji_Presentation}|\\p{Emoji}\\uFE0F)(?:\\p{Emoji_Modifier})?(?:\\u200D(?:\\p{Emoji_Presentation}|\\p{Emoji}\\uFE0F)(?:\\p{Emoji_Modifier})?)*)';
const emojiOnlyRe = new RegExp(`^(?:${emojiPart}|\\s)+$`, 'u');
const emojiRe = new RegExp(emojiPart, 'gu');

export function truncateAddress(address, firstChars = 4, lastChars = 4) {
    if (!address || typeof address !== 'string') return '';
    if (address.length <= firstChars + lastChars) return address;
    return `${address.slice(0, firstChars)}...${address.slice(-lastChars)}`;
}

export function formatDate(ymdString) {
    const [year, month, day] = ymdString.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatHour(hourString) {
    if (hourString === 'now') return 'now';
    const hour = parseInt(hourString);
    if (hour === 0) return '12 AM';
    if (hour === 12) return '12 PM';
    if (hour < 12) return `${hour} AM`;
    return `${hour - 12} PM`;
}

export function formatTimeHHMM(ts, showAMPM = false) {
    if (!ts) return '';
    const d = new Date(ts);
    if (showAMPM) {
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatFullDateTime(timestamp) {
    if (!timestamp) return '';
    return `${new Date(timestamp).getMonth() + 1}/${new Date(timestamp).getDate()} ${formatTimeHHMM(timestamp, true)}`;
}

export function formatDuration(seconds, { hours = true } = {}) {
    const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    if (!hours || minutes < 60) {
        return `${minutes}:${String(rest).padStart(2, '0')}`;
    }
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function formatBytes(bytes, options = {}) {
    const {
        fallback = null,
        minValue = 1,
        unitSeparator = ' ',
        maxUnit = 'GB',
    } = options;
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < minValue) {
        return fallback;
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    const maxIndex = Math.max(0, units.indexOf(maxUnit));
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < maxIndex) {
        size /= 1024;
        unitIndex += 1;
    }

    const rounded = size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1);
    return `${rounded}${unitSeparator}${units[unitIndex]}`;
}

export function formatUserDisplay(user, showAtSymbol = false) {
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

export function getEmojiTextInfo(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || !emojiOnlyRe.test(text)) return null;
    const count = text.match(emojiRe)?.length || 0;
    if (!count) return null;
    const size = count === 1 ? 64 : count === 2 ? 56 : count <= 4 ? 48 : 40;
    return { text, count, size };
}

export const satsInABitcoin = 100000000n;

export const toSats = (v, unit, price) => {
    if (!v) return 0n;
    if (unit === 'sats') return BigInt(v || 0);
    if (unit === 'btc') {
        const [w = '0', d = ''] = v.split('.');
        return BigInt(w) * satsInABitcoin + BigInt(d.padEnd(8, '0').slice(0, 8));
    }
    const usdValue = parseFloat(v);
    if (Number.isNaN(usdValue)) return 0n;
    return BigInt(Math.round((usdValue * Number(satsInABitcoin)) / price));
};

export const toDisplay = (sats, unit, price) => {
    const satsBigInt = typeof sats === 'bigint' ? sats : BigInt(sats || 0);
    if (unit === 'sats') return satsBigInt.toString();
    if (unit === 'btc') {
        const whole = satsBigInt / satsInABitcoin;
        const dec = (satsBigInt % satsInABitcoin).toString().padStart(8, '0').replace(/0+$/, '');
        return dec ? `${whole}.${dec}` : `${whole}`;
    }
    const usdValue = Number(satsBigInt) * (price / Number(satsInABitcoin));
    return usdValue.toFixed(4).replace(/\.?0+$/, '');
};

export function renderMoney(amount, format, price, prefix = '') {
    const formatted = formatMoney(amount, format, price);
    return prefix + formatted;
}

export function renderBalance(amount, format, price) {
    if (amount == null) return '—';
    return renderMoney(amount, format, price);
}

export function renderNet(amount, format, price) {
    if (amount == null) return '—';
    if (Number(amount) === 0) return 'even';
    return renderMoney(amount, format, price, Number(amount) > 0 ? '+' : '');
}
