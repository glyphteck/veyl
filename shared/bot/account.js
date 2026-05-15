import { deriveSeed, deriveWalletMnemonic, getKeyPair } from '../crypto/seed.js';
import { cleanBytes, toHex } from '../crypto/core.js';

function walletPubkey(value) {
    if (value instanceof Uint8Array) {
        return toHex(value);
    }
    const key = String(value ?? '').trim();
    if (!key) {
        throw new Error('wallet public key missing');
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

export async function bootBotAccount(masterSeed, { SparkWallet, network, accountNumber } = {}) {
    if (!SparkWallet) {
        throw new Error('SparkWallet missing');
    }
    if (!network) {
        throw new Error('network missing');
    }

    const walletMnemonic = deriveWalletMnemonic(masterSeed);
    const chatSeed = deriveSeed(masterSeed, 'chat');

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
