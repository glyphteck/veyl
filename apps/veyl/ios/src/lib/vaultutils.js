import { SparkWallet } from '@buildonspark/spark-sdk';
import { httpsCallable } from 'firebase/functions';

import { functions } from '@/lib/firebase';
import { resolveNetwork } from '@glyphteck/shared/network';
import { bootWallet as bootWalletShared, bootChat as bootChatShared, lockWallet, lockChat } from '@glyphteck/shared/vaultutils';

export async function bootWallet(walletMnemonic, user) {
    return bootWalletShared(walletMnemonic, user, {
        SparkWallet,
        httpsCallable,
        functions,
        network: resolveNetwork(globalThis?.process?.env ?? {}),
    });
}

export async function bootChat(chatSeed, user) {
    return bootChatShared(chatSeed, user, {
        httpsCallable,
        functions,
    });
}

export { lockWallet, lockChat };
