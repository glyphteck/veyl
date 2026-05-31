export function nonNegativeNumber(value, fallback) {
    const next = Number(value);
    return Number.isFinite(next) && next >= 0 ? next : fallback;
}

export function positiveNumber(value, fallback) {
    const next = Number(value);
    return Number.isFinite(next) && next > 0 ? next : fallback;
}

export function positiveInt(value, fallback) {
    const next = Math.trunc(Number(value));
    return Number.isFinite(next) && next > 0 ? next : fallback;
}

export function nonNegativeInt(value, fallback) {
    const next = Math.trunc(Number(value));
    return Number.isFinite(next) && next >= 0 ? next : fallback;
}
