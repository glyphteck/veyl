export function getChartVar(name, fallback) {
    if (typeof window === 'undefined') {
        return fallback;
    }
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function getChartColors() {
    return {
        background: getChartVar('--background', '#ffffffcc'),
        foreground: getChartVar('--foreground', '#000000'),
        muted: getChartVar('--muted', '#666666'),
        border: getChartVar('--border', '#e5e5e5'),
        bitcoin: getChartVar('--bitcoin', '#f7931a'),
    };
}

export function getChartDomain(values) {
    const valid = values.filter((value) => Number.isFinite(value));

    if (!valid.length) {
        return [0, 1];
    }

    const min = Math.min(...valid);
    const max = Math.max(...valid);

    if (min === max) {
        if (min === 0) {
            return [-1, 1];
        }
        return [min * 0.8, max * 1.2];
    }

    const range = max - min;
    const padding = range * 0.05;
    return [min - padding, max + padding];
}
