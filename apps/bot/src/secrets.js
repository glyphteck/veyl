import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { BOT_SEEDS_SECRET_ID, botSeedKey } from '@veyl/shared/bot/events';

function secretName(projectId) {
    return `projects/${projectId}/secrets/${BOT_SEEDS_SECRET_ID}`;
}

function secretVersionName(projectId, version = 'latest') {
    return `${secretName(projectId)}/versions/${version}`;
}

function genericSecretVersionName(projectId, secretId, version = 'latest') {
    return `projects/${projectId}/secrets/${secretId}/versions/${version}`;
}

function isNotFound(error) {
    return error?.code === 5 || error?.code === 404;
}

function notFound(message) {
    const error = new Error(message);
    error.code = 5;
    return error;
}

function emptyBundle() {
    return {
        seeds: {},
    };
}

function parseBundle(data) {
    const text = Buffer.from(data || []).toString('utf8').trim();
    if (!text) {
        throw new Error(`${BOT_SEEDS_SECRET_ID} is empty`);
    }

    const parsed = JSON.parse(text);
    const seeds = parsed?.seeds;
    if (!seeds || typeof seeds !== 'object' || Array.isArray(seeds)) {
        throw new Error(`${BOT_SEEDS_SECRET_ID} must contain a seeds object`);
    }

    return {
        seeds: { ...seeds },
    };
}

function encodeSeed(seed) {
    return Buffer.from(seed).toString('base64');
}

function decodeBytes(username, value, label) {
    const encoded = String(value || '').trim();
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new Error(`invalid bot ${label} for @${username}`);
    }

    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length) {
        throw new Error(`empty bot ${label} for @${username}`);
    }

    return new Uint8Array(bytes);
}

function encodeRegistry(registry) {
    if (registry?.v !== 1 || !registry?.iv || !registry?.ct) {
        throw new Error('invalid bot registry');
    }
    return {
        v: registry.v,
        iv: encodeSeed(registry.iv),
        ct: encodeSeed(registry.ct),
    };
}

function decodeRegistry(username, value) {
    if (value?.v !== 1 || !value?.iv || !value?.ct) {
        throw new Error(`invalid bot registry for @${username}`);
    }
    return {
        v: value.v,
        iv: decodeBytes(username, value.iv, 'registry iv'),
        ct: decodeBytes(username, value.ct, 'registry ciphertext'),
    };
}

function encodeBotSecret(secret) {
    if (secret?.v !== 3 || !secret?.masterSeed || !secret?.registry) {
        throw new Error('invalid bot secret');
    }
    return {
        v: 3,
        masterSeed: encodeSeed(secret.masterSeed),
        registry: encodeRegistry(secret.registry),
    };
}

function decodeBotSecret(username, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.v !== 3) {
        throw new Error(`invalid bot secret for @${username}`);
    }
    const masterSeed = decodeBytes(username, value.masterSeed, 'master seed');
    if (masterSeed.length !== 32) {
        throw new Error(`invalid bot master seed for @${username}`);
    }
    return {
        v: 3,
        masterSeed,
        registry: decodeRegistry(username, value.registry),
    };
}

async function ensureSecret(client, projectId) {
    const name = secretName(projectId);
    try {
        await client.getSecret({ name });
        return name;
    } catch (error) {
        if (!isNotFound(error)) {
            throw error;
        }

        const [secret] = await client.createSecret({
            parent: `projects/${projectId}`,
            secretId: BOT_SEEDS_SECRET_ID,
            secret: {
                replication: {
                    automatic: {},
                },
            },
        });
        return secret.name;
    }
}

async function readBundle(client, projectId, options = {}) {
    try {
        const [version] = await client.accessSecretVersion({
            name: secretVersionName(projectId),
        });
        return parseBundle(version?.payload?.data);
    } catch (error) {
        if (options.emptyOnMissing && isNotFound(error)) {
            return emptyBundle();
        }
        throw error;
    }
}

async function disableOldVersions(client, parent, activeName) {
    const [versions] = await client.listSecretVersions({
        parent,
        filter: 'state:ENABLED',
    });

    await Promise.all(versions
        .map((version) => version.name)
        .filter((name) => name && name !== activeName)
        .map((name) => client.disableSecretVersion({ name })));
}

async function writeBundle(client, projectId, bundle) {
    const parent = await ensureSecret(client, projectId);
    const [version] = await client.addSecretVersion({
        parent,
        payload: {
            data: Buffer.from(`${JSON.stringify(bundle)}\n`),
        },
    });

    await disableOldVersions(client, parent, version.name);
}

export function createSecretClient() {
    return new SecretManagerServiceClient();
}

export async function readSecretText(client, projectId, secretId, options = {}) {
    try {
        const [version] = await client.accessSecretVersion({
            name: genericSecretVersionName(projectId, secretId),
        });
        return Buffer.from(version?.payload?.data || []).toString('utf8').trim();
    } catch (error) {
        if (options.optional && isNotFound(error)) {
            return '';
        }
        throw error;
    }
}

export async function loadProcessSecrets(client, projectId, secretIds) {
    const loaded = [];
    const missing = [];
    for (const secretId of secretIds || []) {
        if (!secretId || process.env[secretId]) {
            continue;
        }
        const value = await readSecretText(client, projectId, secretId, { optional: true });
        if (!value) {
            missing.push(secretId);
            continue;
        }
        process.env[secretId] = value;
        loaded.push(secretId);
    }
    return { loaded, missing };
}

export async function readBotSecret(client, projectId, username) {
    const key = botSeedKey(username);
    const bundle = await readBundle(client, projectId);
    const entry = bundle.seeds[key];
    if (!entry) {
        throw notFound(`bot seed not found for @${key}`);
    }

    return decodeBotSecret(key, entry);
}

export async function writeBotSecret(client, projectId, username, secret) {
    const key = botSeedKey(username);
    const bundle = await readBundle(client, projectId, { emptyOnMissing: true });
    bundle.seeds[key] = encodeBotSecret(secret);
    await writeBundle(client, projectId, bundle);
}

export async function ensureBotSecret(client, projectId, username, secret) {
    try {
        return {
            secret: await readBotSecret(client, projectId, username),
            created: false,
        };
    } catch (error) {
        if (!isNotFound(error)) {
            throw error;
        }

        await writeBotSecret(client, projectId, username, secret);
        return {
            secret: {
                v: 3,
                masterSeed: new Uint8Array(secret.masterSeed),
                registry: {
                    v: secret.registry.v,
                    iv: new Uint8Array(secret.registry.iv),
                    ct: new Uint8Array(secret.registry.ct),
                },
            },
            created: true,
        };
    }
}

export async function deleteBotSeed(client, projectId, username) {
    const key = botSeedKey(username);
    const bundle = await readBundle(client, projectId, { emptyOnMissing: true });
    if (!bundle.seeds[key]) {
        return;
    }

    delete bundle.seeds[key];
    await writeBundle(client, projectId, bundle);
}
