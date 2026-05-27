export const MAINMENU_ROW_HEIGHT = 36;
export const MAINMENU_LIST_HEIGHT = 384;
export const MAINMENU_MIN_RENDER_ROWS = 44;

export function formatCacheSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function textMatches(row, raw) {
    const needle = raw.trim().toLowerCase();
    if (!needle) return true;
    return [row?.label, row?.value, ...(row?.keywords || [])].some((text) => String(text || '').toLowerCase().includes(needle));
}

export function countMainMenuRows(sections) {
    return sections.reduce((total, section) => total + (section.count || 0), 0);
}

export function findMainMenuRow(sections, index) {
    if (index < 0) return null;
    let start = 0;
    for (const section of sections) {
        const count = section.count || 0;
        if (index < start + count) {
            const localIndex = index - start;
            return {
                section,
                localIndex,
                key: section.keyFor?.(localIndex) ?? `${section.key}-${localIndex}`,
            };
        }
        start += count;
    }
    return null;
}

export function getMainMenuWindow({
    scrollTop,
    total,
    rowHeight = MAINMENU_ROW_HEIGHT,
    listHeight = MAINMENU_LIST_HEIGHT,
    minRows = MAINMENU_MIN_RENDER_ROWS,
}) {
    if (!total) return { start: 0, end: 0 };

    const visibleRows = Math.max(1, Math.ceil(listHeight / rowHeight));
    const targetRows = Math.min(total, Math.max(visibleRows, minRows));
    const firstVisible = Math.max(0, Math.floor(scrollTop / rowHeight));
    let start = Math.max(0, firstVisible - Math.floor((targetRows - visibleRows) / 2));
    let end = Math.min(total, start + targetRows);

    if (end - start < targetRows) {
        start = Math.max(0, end - targetRows);
    }

    return { start, end };
}

export function getMainMenuPeers({ peers = [], recentPeers, excludeUid } = {}) {
    const seen = new Set();
    const ordered = [];
    const add = (peer) => {
        if (!peer?.uid || peer.uid === excludeUid || seen.has(peer.uid)) return;
        seen.add(peer.uid);
        ordered.push(peer);
    };

    for (const peer of recentPeers?.all || []) add(peer);

    const remaining = [];
    for (const peer of peers || []) {
        if (peer?.uid && peer.uid !== excludeUid && !seen.has(peer.uid)) {
            remaining.push(peer);
        }
    }
    remaining.sort((a, b) => String(a?.username || a?.uid || '').localeCompare(String(b?.username || b?.uid || '')));
    remaining.forEach(add);

    return ordered;
}

function timeMs(value) {
    if (typeof value?.toMillis === 'function') {
        const ms = value.toMillis();
        return Number.isFinite(ms) ? ms : 0;
    }
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : 0;
    }
    if (Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : 0;
    }
    return 0;
}

export function sortMainMenuTransactions(transactions = []) {
    return [...(transactions || [])].sort((a, b) => {
        const delta = timeMs(b?.createdTime) - timeMs(a?.createdTime);
        if (delta !== 0) return delta;
        return String(b?.id || '').localeCompare(String(a?.id || ''));
    });
}
