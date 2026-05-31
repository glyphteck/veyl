import { lowerText } from '@veyl/shared/utils/text';
import { compareProfilesByName } from '@veyl/shared/search/sort';

export const ROW_HEIGHT = 36;
export const LIST_HEIGHT = 384;
export const MIN_RENDER_ROWS = 44;

export function textMatches(row, raw) {
    const needle = lowerText(raw);
    if (!needle) return true;
    return [row?.label, row?.value, ...(row?.keywords || [])].some((text) => lowerText(text).includes(needle));
}

export function countRows(sections) {
    return sections.reduce((total, section) => total + (section.count || 0), 0);
}

export function findRow(sections, index) {
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

export function getVisibleWindow({
    scrollTop,
    total,
    rowHeight = ROW_HEIGHT,
    listHeight = LIST_HEIGHT,
    minRows = MIN_RENDER_ROWS,
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

export function getOrderedPeers({ peers = [], recentPeers, excludeUid } = {}) {
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
    remaining.sort(compareProfilesByName);
    remaining.forEach(add);

    return ordered;
}
