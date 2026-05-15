import { getKeyPair } from './crypto/seed.js';
import { clearChatPairCache } from './chat/utils.js';
import { hasWalletPKForNetwork } from './walletkeys.js';

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

    const idPk = await wallet.getIdentityPublicKey();

    // First time setup
    if (!user.walletPK) {
        await httpsCallable(functions, 'setWalletPK')({ walletPK: idPk, network });
    } else if (String(user.walletPK).toLowerCase() !== String(idPk).toLowerCase()) {
        throw new Error('wallet key mismatch for account');
    } else if (!hasWalletPKForNetwork(user, network)) {
        await httpsCallable(functions, 'setWalletPK')({ walletPK: idPk, network });
    }
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
