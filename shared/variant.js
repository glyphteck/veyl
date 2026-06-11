import { lowerText } from './utils/text.js';

const VARIANT_ALIASES = Object.freeze({
    development: 'dev',
    testing: 'test',
    production: 'prod',
});

const VARIANTS = new Set(['dev', 'test', 'prod']);

export function normalizeVariant(value, fallback = 'dev') {
    const raw = lowerText(value);
    const variant = VARIANT_ALIASES[raw] || raw;
    return VARIANTS.has(variant) ? variant : fallback;
}

export function resolveVariant(env = {}, fallback = 'dev') {
    const explicit = env.NEXT_PUBLIC_VEYL_VARIANT || env.EXPO_PUBLIC_VEYL_VARIANT || env.VEYL_IOS_VARIANT || env.VEYL_VARIANT;
    return normalizeVariant(explicit, fallback);
}
