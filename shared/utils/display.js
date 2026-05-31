const EMOJI_PART =
    '(?:\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|(?:\\p{Emoji_Presentation}|\\p{Emoji}\\uFE0F)(?:\\p{Emoji_Modifier})?(?:\\u200D(?:\\p{Emoji_Presentation}|\\p{Emoji}\\uFE0F)(?:\\p{Emoji_Modifier})?)*)';
const EMOJI_ONLY_RE = new RegExp(`^(?:${EMOJI_PART}|\\s)+$`, 'u');
const EMOJI_RE = new RegExp(EMOJI_PART, 'gu');

export function truncateAddress(address, firstChars = 4, lastChars = 4) {
    if (!address || typeof address !== 'string') return '';
    if (address.length <= firstChars + lastChars) return address;
    return `${address.slice(0, firstChars)}...${address.slice(-lastChars)}`;
}

export function truncateLabel(label, max = 8, marker = '...') {
    const text = String(label || '');
    if (!text || text.length <= max) return text;
    return `${text.slice(0, max)}${marker}`;
}

export function safeIdPart(value, fallback = 'id') {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '') || fallback;
}

export function prefixedId(prefix, value, fallback = 'id') {
    return `${prefix}-${safeIdPart(value, fallback)}`;
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

export function formatCacheSize(bytes) {
    return formatBytes(bytes, { fallback: '0 B', minValue: 0 });
}

export function getEmojiTextInfo(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || !EMOJI_ONLY_RE.test(text)) return null;
    const count = text.match(EMOJI_RE)?.length || 0;
    if (!count) return null;
    const size = count === 1 ? 64 : count === 2 ? 56 : count <= 4 ? 48 : 40;
    return { text, count, size };
}
