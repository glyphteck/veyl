import { lowerText } from './utils/text.js';

const VARIANT_ALIASES = Object.freeze({
    development: 'dev',
    testing: 'test',
    production: 'prod',
});

const VEYL_VARIANTS = new Set(['dev', 'test', 'prod']);

export function normalizeVeylVariant(value, fallback = 'dev') {
    const raw = lowerText(value);
    const variant = VARIANT_ALIASES[raw] || raw;
    return VEYL_VARIANTS.has(variant) ? variant : fallback;
}

export function resolveVeylVariant(env = {}, fallback = 'dev') {
    const explicit = env.NEXT_PUBLIC_VEYL_VARIANT || env.EXPO_PUBLIC_VEYL_VARIANT || env.VEYL_IOS_VARIANT || env.VEYL_VARIANT;
    return normalizeVeylVariant(explicit, fallback);
}
