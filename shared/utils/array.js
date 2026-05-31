export function uniqueValues(items) {
    return [...new Set((Array.isArray(items) ? items : []).filter(Boolean))];
}

export function uniqueSet(items) {
    return new Set(uniqueValues(items));
}

export function sortedUniqueValues(items) {
    return uniqueValues(items).sort();
}

export function sameArray(a, b) {
    if (a === b) {
        return true;
    }
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
    }
    for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index]) {
            return false;
        }
    }
    return true;
}
