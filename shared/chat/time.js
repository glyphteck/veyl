export function toMillis(ts, fallback = 0) {
    if (typeof ts?.toMillis === 'function') {
        const ms = ts.toMillis();
        return Number.isFinite(ms) ? ms : fallback;
    }
    if (ts instanceof Date) {
        const ms = ts.getTime();
        return Number.isFinite(ms) ? ms : fallback;
    }
    if (Number.isFinite(ts)) {
        return ts;
    }
    return fallback;
}

export function valueMillis(value) {
    if (value == null) {
        return null;
    }
    if (typeof value?.toMillis === 'function') {
        const ms = value.toMillis();
        return Number.isFinite(ms) ? ms : null;
    }
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    if (Number.isFinite(value)) {
        return value;
    }
    return String(value);
}
