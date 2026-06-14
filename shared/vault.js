import { getKeyPair } from './crypto/seed.js';
import { clearChatPairCache } from './chat/pairs.js';
import { markDiag, markDone, markError } from './utils/diagnostics.js';
import { lowerText, sameText } from './utils/text.js';
import { hasWalletPKForNetwork } from './wallet/keys.js';

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

export async function bootWallet(walletMnemonic, user, { SparkWallet, cloud, network, enableTokenSync = false, diag = null } = {}) {
    if (!SparkWallet) throw new Error('SparkWallet missing');
    if (!cloud) throw new Error('cloud missing');
    if (!network) throw new Error('network missing');
    const startedAt = Date.now();
    markDiag(diag, 'vault.bootWallet.start', {
        enableTokenSync: !!enableTokenSync,
        ghostWallet: user?.settings?.ghostWallet === true,
        hasWalletPK: !!user?.walletPK,
        hasWalletPKForNetwork: hasWalletPKForNetwork(user, network),
    });
    const WalletClass = getBootWalletClass(SparkWallet, { enableTokenSync });
    const initializeWallet = WalletClass.getOrCreateWallet || WalletClass.initialize;
    try {
        // boot wallet
        let wallet;
        const sparkStartedAt = Date.now();
        markDiag(diag, 'vault.bootWallet.spark.start', {});
        ({ wallet } = await initializeWallet.call(WalletClass, {
            mnemonicOrSeed: walletMnemonic,
            forceReinit: true,
            options: {
                network,
                tokenOptimizationOptions: { enabled: false },
            },
        }));
        markDone(diag, 'vault.bootWallet.spark', sparkStartedAt);

        const identityStartedAt = Date.now();
        markDiag(diag, 'vault.bootWallet.identity.start', {});
        const idPk = await wallet.getIdentityPublicKey();
        const walletPK = lowerText(idPk);
        markDone(diag, 'vault.bootWallet.identity', identityStartedAt);

        // First-time setup.
        const setupStartedAt = Date.now();
        if (!user.walletPK) {
            markDiag(diag, 'vault.bootWallet.setup.start', { reason: 'missing-wallet-pk' });
            await cloud.user.profile.walletpk.write(idPk, { network });
            markDone(diag, 'vault.bootWallet.setup', setupStartedAt, { wrote: true });
        } else if (!sameText(user.walletPK, walletPK)) {
            throw new Error('wallet identity mismatch for account');
        } else if (!hasWalletPKForNetwork(user, network)) {
            markDiag(diag, 'vault.bootWallet.setup.start', { reason: 'missing-network-wallet-pk' });
            await cloud.user.profile.walletpk.write(idPk, { network });
            markDone(diag, 'vault.bootWallet.setup', setupStartedAt, { wrote: true });
        } else {
            markDiag(diag, 'vault.bootWallet.setup.skip', { elapsedMs: Date.now() - setupStartedAt });
        }
        markDone(diag, 'vault.bootWallet', startedAt);
        return wallet;
    } catch (error) {
        markError(diag, 'vault.bootWallet', startedAt, error);
        throw error;
    }
}

export async function bootChat(chatSeed, user, { cloud, diag = null } = {}) {
    const startedAt = Date.now();
    markDiag(diag, 'vault.bootChat.start', { hasChatPK: !!user?.chatPK });
    try {
        if (!cloud) throw new Error('cloud missing');
        // Generate chat key pair
        const keyStartedAt = Date.now();
        const chatKeyPair = getKeyPair(chatSeed);
        chatSeed.fill(0);
        const chatPKHex = bytesToHex(chatKeyPair.pub);
        markDone(diag, 'vault.bootChat.derive', keyStartedAt);
        // First-time setup.
        if (!user.chatPK) {
            const setupStartedAt = Date.now();
            markDiag(diag, 'vault.bootChat.setup.start', { reason: 'missing-chat-pk' });
            await cloud.user.profile.chatpk.write(chatPKHex);
            markDone(diag, 'vault.bootChat.setup', setupStartedAt, { wrote: true });
        } else if (!sameText(user.chatPK, chatPKHex)) {
            chatKeyPair.priv.fill(0);
            chatKeyPair.pub.fill(0);
            throw new Error('chat identity mismatch for account');
        } else {
            markDiag(diag, 'vault.bootChat.setup.skip', {});
        }
        chatKeyPair.pub.fill(0);
        markDone(diag, 'vault.bootChat', startedAt);
        return chatKeyPair.priv;
    } catch (error) {
        markError(diag, 'vault.bootChat', startedAt, error);
        chatSeed.fill(0);
        throw error;
    }
}

export function lockWallet(wallet) {
    try {
        const cleanup = typeof wallet?.cleanup === 'function' ? wallet.cleanup() : wallet?.cleanupConnections?.();
        cleanup?.catch?.(() => {});
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
