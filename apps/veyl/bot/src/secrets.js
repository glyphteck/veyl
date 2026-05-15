import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { botSecretId } from '@glyphteck/shared/bot/events';

function secretName(projectId, username) {
    return `projects/${projectId}/secrets/${botSecretId(username)}`;
}

function secretVersionName(projectId, username, version = 'latest') {
    return `${secretName(projectId, username)}/versions/${version}`;
}

function isNotFound(error) {
    return error?.code === 5 || error?.code === 404;
}

export function createSecretClient() {
    return new SecretManagerServiceClient();
}

export async function readBotSeed(client, projectId, username) {
    const [version] = await client.accessSecretVersion({
        name: secretVersionName(projectId, username),
    });

    return new Uint8Array(version?.payload?.data || []);
}

export async function writeBotSeed(client, projectId, username, seed) {
    const name = secretName(projectId, username);

    try {
        await client.getSecret({ name });
    } catch (error) {
        if (!isNotFound(error)) {
            throw error;
        }

        await client.createSecret({
            parent: `projects/${projectId}`,
            secretId: botSecretId(username),
            secret: {
                replication: {
                    automatic: {},
                },
            },
        });
    }

    await client.addSecretVersion({
        parent: name,
        payload: {
            data: Buffer.from(seed),
        },
    });
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
    try {
        await client.deleteSecret({
            name: secretName(projectId, username),
        });
    } catch (error) {
        if (!isNotFound(error)) {
            throw error;
        }
    }
}
