const VARIANT_ALIASES = Object.freeze({
    development: 'dev',
    testing: 'test',
    production: 'prod',
});

const VEYL_VARIANTS = new Set(['dev', 'test', 'prod']);

export function normalizeVeylVariant(value, fallback = 'dev') {
    const raw = String(value || '').trim().toLowerCase();
    const variant = VARIANT_ALIASES[raw] || raw;
    return VEYL_VARIANTS.has(variant) ? variant : fallback;
}

export function resolveVeylVariant(env = {}, fallback = 'dev') {
    const explicit = env.NEXT_PUBLIC_VEYL_VARIANT || env.EXPO_PUBLIC_VEYL_VARIANT || env.VEYL_IOS_VARIANT || env.VEYL_VARIANT;
    if (explicit) {
        return normalizeVeylVariant(explicit, fallback);
    }

    const network = String(env.NEXT_PUBLIC_NETWORK || env.EXPO_PUBLIC_NETWORK || env.NETWORK || '').trim().toUpperCase();
    return network === 'MAINNET' ? 'prod' : fallback;
}
