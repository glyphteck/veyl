import { deriveLegacyWalletEntropy, deriveSeed, getChatSeed, getDefaultWalletEntropy, getKeyPair, mnemonicFromWalletEntropy, openSecretRegistry } from '../crypto/seed.js';
import { cleanBytes, toHex } from '../crypto/core.js';
import { cleanText } from '../utils/text.js';

function walletPubkey(value) {
    if (value instanceof Uint8Array) {
        return toHex(value);
    }
    const key = cleanText(value);
    if (!key) {
        throw new Error('wallet identity missing');
    }
    return key;
}

export function closeBotAccount(account) {
    try {
        account?.wallet?.cleanupConnections?.();
    } catch {}
    try {
        account?.chatPrivKey?.fill?.(0);
    } catch {}
}

export async function bootBotAccountFromSecrets(walletEntropy, chatSeed, { SparkWallet, network, accountNumber } = {}) {
    if (!SparkWallet) {
        throw new Error('SparkWallet missing');
    }
    if (!network) {
        throw new Error('network missing');
    }

    const walletMnemonic = mnemonicFromWalletEntropy(walletEntropy);

    let wallet = null;
    let chatPrivKey = null;
    let chatPubKey = null;

    try {
        const result = await SparkWallet.initialize({
            mnemonicOrSeed: walletMnemonic,
            accountNumber,
            options: {
                network,
                optimizationOptions: { auto: false },
                tokenOptimizationOptions: { enabled: false },
            },
        });

        wallet = result?.wallet;
        if (!wallet) {
            throw new Error('wallet boot failed');
        }

        const walletPK = walletPubkey(await wallet.getIdentityPublicKey());
        const chatKeyPair = getKeyPair(chatSeed);
        chatPrivKey = chatKeyPair.priv;
        chatPubKey = chatKeyPair.pub;

        return {
            wallet,
            walletPK,
            chatPK: toHex(chatPubKey),
            chatPrivKey,
        };
    } catch (error) {
        closeBotAccount({ wallet, chatPrivKey });
        throw error;
    } finally {
        cleanBytes(chatSeed, chatPubKey);
    }
}

export async function bootBotAccount(masterSeed, options = {}) {
    const walletEntropy = deriveLegacyWalletEntropy(masterSeed);
    const chatSeed = deriveSeed(masterSeed, 'chat');
    try {
        return await bootBotAccountFromSecrets(walletEntropy, chatSeed, options);
    } finally {
        cleanBytes(walletEntropy, chatSeed);
    }
}

export async function bootRegistryBotAccount(masterSeed, registryEnvelope, options = {}) {
    const registry = await openSecretRegistry(masterSeed, registryEnvelope);
    const walletEntropy = getDefaultWalletEntropy(registry);
    const chatSeed = getChatSeed(registry);
    try {
        return await bootBotAccountFromSecrets(walletEntropy, chatSeed, options);
    } finally {
        cleanBytes(walletEntropy, chatSeed);
    }
}
