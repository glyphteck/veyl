import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    PASSKEY_DOMAIN,
    allowedPasskeyOrigins,
    appLinkDomains,
    domains,
    links,
    origins,
    storageCorsOrigins,
} from '@veyl/shared/links';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function makeStorageCors() {
    return [
        {
            origin: [...storageCorsOrigins],
            method: ['GET', 'HEAD', 'PUT'],
            responseHeader: ['Content-Type', 'Content-Length', 'Content-Disposition', 'Cache-Control', 'ETag'],
            maxAgeSeconds: 3600,
        },
    ];
}

export async function writeStorageCors() {
    const file = resolve(rootDir, 'storage.cors.json');
    await writeFile(file, `${JSON.stringify(makeStorageCors(), null, 4)}\n`);
}

export async function writeLinksDoc() {
    const file = resolve(rootDir, 'links.md');
    const body = `# Links

This file is generated from \`shared/links.js\` by \`bun scripts/links.mjs\`.

## Domains

| Name | Value |
| --- | --- |
${Object.entries(domains).map(([key, value]) => `| \`${key}\` | \`${value}\` |`).join('\n')}

## Origins

| Name | Value |
| --- | --- |
${Object.entries(origins).map(([key, value]) => `| \`${key}\` | \`${value}\` |`).join('\n')}

## Product Links

| Name | Value |
| --- | --- |
${Object.entries(links).map(([key, value]) => `| \`${key}\` | \`${value}\` |`).join('\n')}
`;
    await writeFile(file, body);
}

export async function writeFunctionsLinks() {
    const file = resolve(rootDir, 'functions', 'lib', 'links.js');
    const body = `// Generated from shared/links.js by scripts/links.mjs.
export const PASSKEY_DOMAIN = ${JSON.stringify(PASSKEY_DOMAIN)};

export const links = Object.freeze({
    root: ${JSON.stringify(links.root)},
    contact: ${JSON.stringify(links.contact)},
});

export const allowedPasskeyOrigins = Object.freeze(${JSON.stringify(allowedPasskeyOrigins, null, 4)});
`;
    await writeFile(file, body);
}

export async function writeIosLinks() {
    const file = resolve(rootDir, 'apps', 'veyl', 'ios', 'links.config.js');
    const body = `// Generated from shared/links.js by scripts/links.mjs.
const PASSKEY_DOMAIN = ${JSON.stringify(PASSKEY_DOMAIN)};

const appLinkDomains = Object.freeze(${JSON.stringify(appLinkDomains, null, 4)});

module.exports = {
    PASSKEY_DOMAIN,
    appLinkDomains,
};
`;
    await writeFile(file, body);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await writeIosLinks();
    await writeFunctionsLinks();
    await writeStorageCors();
    await writeLinksDoc();
}
