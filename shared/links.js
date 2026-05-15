export const ROOT_DOMAIN = 'glyphteck.com';
export const PASSKEY_DOMAIN = ROOT_DOMAIN;

export const domains = Object.freeze({
    root: ROOT_DOMAIN,
    rootDev: `dev.${ROOT_DOMAIN}`,
    veyl: `veyl.${ROOT_DOMAIN}`,
    veylTest: `test.veyl.${ROOT_DOMAIN}`,
    veylDev: `dev.veyl.${ROOT_DOMAIN}`,
});

export const origins = Object.freeze({
    root: `https://${domains.root}`,
    rootDev: `https://${domains.rootDev}`,
    rootDevWeb: `https://${domains.rootDev}:3001`,
    veyl: `https://${domains.veyl}`,
    veylTest: `https://${domains.veylTest}`,
    veylDev: `https://${domains.veylDev}`,
    veylDevWeb: `https://${domains.veylDev}:3000`,
});

export const links = Object.freeze({
    root: origins.root,
    rootDev: origins.rootDev,
    rootDevWeb: origins.rootDevWeb,
    veyl: origins.veyl,
    veylTest: origins.veylTest,
    veylDev: origins.veylDev,
    veylDevWeb: origins.veylDevWeb,
    contact: `mailto:contact@${ROOT_DOMAIN}`,
    review: `${origins.veylTest}/review`,
    regtestFaucet: 'https://app.lightspark.com/regtest-faucet',
});

export const localHosts = Object.freeze([
    domains.rootDev,
    domains.veylDev,
]);

export const appDomains = Object.freeze([
    domains.veyl,
    domains.veylTest,
]);

export const appLinkDomains = Object.freeze([
    domains.veyl,
    domains.veylTest,
    domains.veylDev,
]);

export const allowedPasskeyOrigins = Object.freeze([
    origins.root,
    origins.rootDev,
    origins.rootDevWeb,
    origins.veylDev,
    origins.veylDevWeb,
    origins.veylTest,
    origins.veyl,
]);

export const storageCorsOrigins = Object.freeze([
    origins.rootDevWeb,
    origins.veylDev,
    origins.veylDevWeb,
    origins.veyl,
    origins.veylTest,
]);

export const webApps = Object.freeze({
    veyl: Object.freeze({
        domain: domains.veylDev,
        origin: origins.veylDevWeb,
        port: '3000',
    }),
});

export function getOrigin(domain) {
    return `https://${domain}`;
}
