function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function fallbackAttachment(type, path, name = '', mimeType = '') {
    if (!path) {
        return null;
    }

    return {
        path,
        kind: type || 'file',
        name: name || 'attachment',
        mimeType: mimeType || (type === 'img' ? 'image/webp' : ''),
    };
}

export function reportCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

export function timestampMs(value) {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value?.seconds === 'number') return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000);
    if (typeof value?._seconds === 'number') return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1000000);
    const next = Number(value);
    return Number.isFinite(next) ? next : 0;
}

export function sortOffenders(rows = []) {
    return [...rows].sort((a, b) => {
        const byCount = reportCount(b?.count) - reportCount(a?.count);
        if (byCount) {
            return byCount;
        }
        return timestampMs(b?.lastReportAt) - timestampMs(a?.lastReportAt);
    });
}

export function parseReportEvidence(report = {}) {
    return {
        type: cleanText(report?.type),
        note: cleanText(report?.note),
        content: cleanText(report?.content),
        attachment: fallbackAttachment(cleanText(report?.type), cleanText(report?.path)),
    };
}
