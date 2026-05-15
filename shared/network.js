export const DEFAULT_NETWORK = 'REGTEST';
export { ROOT_DOMAIN, PASSKEY_DOMAIN, appDomains as APP_DOMAINS } from './links.js';
import { domains, getOrigin } from './links.js';

export const MAINNET_DOMAIN = domains.veyl;
export const REGTEST_DOMAIN = domains.veylTest;

export function resolveNetwork(env = {}) {
    const raw = env?.EXPO_PUBLIC_NETWORK ?? env?.NEXT_PUBLIC_NETWORK ?? env?.NETWORK ?? DEFAULT_NETWORK;
    return String(raw).toUpperCase();
}

export function isMainnet(network) {
    return String(network ?? '').toUpperCase() === 'MAINNET';
}

export function getAddressNetwork(address) {
    const a = String(address ?? '').trim();
    if (!a) return null;
    if (/^bcrt1[ac-hj-np-z02-9]{39,87}$/i.test(a)) return 'REGTEST';
    if (/^bc1[ac-hj-np-z02-9]{39,87}$/i.test(a)) return 'MAINNET';
    if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(a)) return 'MAINNET';
    return null;
}

export function isAddressOnNetwork(address, network) {
    const detected = getAddressNetwork(address);
    return detected !== null && detected === String(network ?? '').toUpperCase();
}

export function getAppDomain(network) {
    return isMainnet(network) ? MAINNET_DOMAIN : REGTEST_DOMAIN;
}

export function getAppOrigin(network) {
    return getOrigin(getAppDomain(network));
}

export function getPasskeyOrigin() {
    return getOrigin(domains.root);
}
