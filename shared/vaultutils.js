import { getKeyPair } from './crypto/seed.js';
import { clearChatPairCache } from './chat/utils.js';
import { hasWalletPKForNetwork } from './walletkeys.js';

const WALLET_WEBHOOK_EVENT_TYPES = [
    'SPARK_STATIC_DEPOSIT_FINISHED',
    'SPARK_LIGHTNING_RECEIVE_FINISHED',
    'SPARK_LIGHTNING_SEND_FINISHED',
    'SPARK_COOP_EXIT_FINISHED',
];

function getBootWalletClass(SparkWallet, { enableTokenSync = false } = {}) {
    if (enableTokenSync) {
        return SparkWallet;
    }

    return class BitcoinOnlySparkWallet extends SparkWallet {
        async syncTokenOutputs() {
            // Spark 0.8 syncs all token outputs during init and balance reads.
            // The current app is BTC-only, so keep unlock off that slow path until token UI ships.
        }
    };
}

async function syncWalletPrivacy(wallet, ghostWallet) {
    if (typeof wallet?.setPrivacyEnabled !== 'function') {
        return;
    }

    const desired = ghostWallet === true;
    const current = typeof wallet.getWalletSettings === 'function' ? await wallet.getWalletSettings() : null;
    if ((current?.privateEnabled === true) === desired) {
        return;
    }

    await wallet.setPrivacyEnabled(desired);
}

function normalizedEventSet(events) {
    return new Set((Array.isArray(events) ? events : []).map((event) => String(event ?? '').trim()).filter(Boolean));
}

function sameEventSet(left, right) {
    const a = normalizedEventSet(left);
    const b = normalizedEventSet(right);
    if (a.size !== b.size) {
        return false;
    }
    for (const item of a) {
        if (!b.has(item)) {
            return false;
        }
    }
    return true;
}

function readWebhookId(result) {
    if (typeof result?.id === 'string' && result.id) {
        return result.id;
    }
    if (typeof result?.webhook_id === 'string' && result.webhook_id) {
        return result.webhook_id;
    }
    return typeof result?.webhookId === 'string' && result.webhookId ? result.webhookId : null;
}

async function findRegisteredWebhook(wallet, url, eventTypes) {
    if (typeof wallet?.listSparkWalletWebhooks !== 'function') {
        return null;
    }

    const result = await wallet.listSparkWalletWebhooks();
    const webhooks = Array.isArray(result?.webhooks) ? result.webhooks : [];
    return webhooks.find((entry) => entry?.url === url && sameEventSet(entry.event_types ?? entry.eventTypes, eventTypes)) || null;
}

async function registerWalletNotifications(wallet, user, walletPK, { httpsCallable, functions, network } = {}) {
    if (typeof wallet?.registerSparkWalletWebhook !== 'function') {
        return;
    }

    try {
        const prepare = httpsCallable(functions, 'prepareWalletNotifications');
        const confirm = httpsCallable(functions, 'confirmWalletNotifications');
        const prepared = await prepare({ network, walletPK });
        const url = typeof prepared?.data?.url === 'string' ? prepared.data.url : '';
        const secret = typeof prepared?.data?.secret === 'string' ? prepared.data.secret : '';
        const eventTypes = Array.isArray(prepared?.data?.eventTypes) && prepared.data.eventTypes.length ? prepared.data.eventTypes : WALLET_WEBHOOK_EVENT_TYPES;
        if (!url || !secret) {
            throw new Error('wallet notification route missing');
        }

        const existing = await findRegisteredWebhook(wallet, url, eventTypes).catch(() => null);
        let webhookId = readWebhookId(existing);
        if (!webhookId) {
            const registered = await wallet.registerSparkWalletWebhook({
                secret,
                url,
                event_types: eventTypes,
            });
            webhookId = readWebhookId(registered);
        }

        await confirm({ network, walletPK, webhookId, url });
    } catch (error) {
        console.warn('wallet notification registration failed', error?.message ?? error);
    }
}

function scheduleWalletNotifications(wallet, user, walletPK, options) {
    const run = () => {
        void registerWalletNotifications(wallet, user, walletPK, options);
    };

    if (typeof setTimeout === 'function') {
        setTimeout(run, 0);
        return;
    }

    run();
}

function bytesToHex(bytes) {
    return Array.from(bytes || [])
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

export async function bootWallet(walletMnemonic, user, { SparkWallet, httpsCallable, functions, network, enableTokenSync = false } = {}) {
    if (!SparkWallet) throw new Error('SparkWallet missing');
    if (!httpsCallable) throw new Error('httpsCallable missing');
    if (!functions) throw new Error('functions missing');
    if (!network) throw new Error('network missing');
    const WalletClass = getBootWalletClass(SparkWallet, { enableTokenSync });
    const initializeWallet = WalletClass.getOrCreateWallet || WalletClass.initialize;
    // boot wallet
    let wallet;
    ({ wallet } = await initializeWallet.call(WalletClass, {
        mnemonicOrSeed: walletMnemonic,
        options: {
            network,
            tokenOptimizationOptions: { enabled: false },
        },
    }));
    await syncWalletPrivacy(wallet, user?.settings?.ghostWallet);

    const idPk = await wallet.getIdentityPublicKey();
    const walletPK = String(idPk).toLowerCase();

    // First time setup
    if (!user.walletPK) {
        await httpsCallable(functions, 'setWalletPK')({ walletPK: idPk, network });
    } else if (String(user.walletPK).toLowerCase() !== walletPK) {
        throw new Error('wallet key mismatch for account');
    } else if (!hasWalletPKForNetwork(user, network)) {
        await httpsCallable(functions, 'setWalletPK')({ walletPK: idPk, network });
    }
    scheduleWalletNotifications(wallet, user, walletPK, { httpsCallable, functions, network });
    return wallet;
}

export async function bootChat(chatSeed, user, { httpsCallable, functions } = {}) {
    try {
        if (!httpsCallable) throw new Error('httpsCallable missing');
        if (!functions) throw new Error('functions missing');
        // Generate chat key pair
        const chatKeyPair = getKeyPair(chatSeed);
        chatSeed.fill(0);
        const chatPKHex = bytesToHex(chatKeyPair.pub);
        // fires time set up
        if (!user.chatPK) {
            await httpsCallable(functions, 'setChatPK')({ chatPK: chatPKHex });
        } else if (String(user.chatPK).toLowerCase() !== chatPKHex) {
            chatKeyPair.priv.fill(0);
            chatKeyPair.pub.fill(0);
            throw new Error('chat key mismatch for account');
        }
        chatKeyPair.pub.fill(0);
        return chatKeyPair.priv;
    } catch (error) {
        chatSeed.fill(0);
        throw error;
    }
}

export function lockWallet(wallet) {
    try {
        wallet?.cleanupConnections();
    } catch {}
}

export function lockChat(chatPrivateKey) {
    try {
        if (chatPrivateKey) {
            chatPrivateKey.fill(0);
        }
    } catch {}
    try {
        clearChatPairCache();
    } catch {}
}
