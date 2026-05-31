export function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function lowerText(value) {
    return cleanText(value).toLowerCase();
}

export function sameText(left, right) {
    return lowerText(left) === lowerText(right);
}
