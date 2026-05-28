import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { BOT_SEEDS_SECRET_ID, botSeedKey } from '@glyphteck/shared/bot/events';

function secretName(projectId) {
    return `projects/${projectId}/secrets/${BOT_SEEDS_SECRET_ID}`;
}

function secretVersionName(projectId, version = 'latest') {
    return `${secretName(projectId)}/versions/${version}`;
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

function decodeSeed(username, value) {
    const encoded = String(value || '').trim();
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new Error(`invalid bot seed for @${username}`);
    }

    const seed = Buffer.from(encoded, 'base64');
    if (!seed.length) {
        throw new Error(`empty bot seed for @${username}`);
    }

    return new Uint8Array(seed);
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

export async function readBotSeed(client, projectId, username) {
    const key = botSeedKey(username);
    const bundle = await readBundle(client, projectId);
    const encoded = bundle.seeds[key];
    if (!encoded) {
        throw notFound(`bot seed not found for @${key}`);
    }

    return decodeSeed(key, encoded);
}

export async function writeBotSeed(client, projectId, username, seed) {
    const key = botSeedKey(username);
    const bundle = await readBundle(client, projectId, { emptyOnMissing: true });
    bundle.seeds[key] = encodeSeed(seed);
    await writeBundle(client, projectId, bundle);
}

export async function ensureBotSeed(client, projectId, username, seed) {
    try {
        return {
            seed: await readBotSeed(client, projectId, username),
            created: false,
        };
    } catch (error) {
        if (!isNotFound(error)) {
            throw error;
        }

        await writeBotSeed(client, projectId, username, seed);
        return {
            seed: new Uint8Array(seed),
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
