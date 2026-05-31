export function firstRouteParam(value) {
    return Array.isArray(value) ? value[0] : value;
}

export function textRouteParam(value, fallback = '') {
    const first = firstRouteParam(value);
    return typeof first === 'string' ? first : fallback;
}

export function getRouteParam(params, key) {
    const raw = typeof params?.get === 'function' ? params.get(key) : params?.[key];
    return firstRouteParam(raw) ?? null;
}
