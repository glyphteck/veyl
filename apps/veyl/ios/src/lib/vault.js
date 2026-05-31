import { SparkWallet } from '@buildonspark/spark-sdk';
import { httpsCallable } from 'firebase/functions';

import { functions } from '@/lib/firebase';
import { resolveNetwork } from '@veyl/shared/network';
import { bootWallet as bootWalletShared, bootChat as bootChatShared, lockWallet, lockChat } from '@veyl/shared/vault';
import { mark } from '@/lib/diagnostics';

export async function bootWallet(walletMnemonic, user) {
    return bootWalletShared(walletMnemonic, user, {
        SparkWallet,
        httpsCallable,
        functions,
        network: resolveNetwork(globalThis?.process?.env ?? {}),
        diag: mark,
    });
}

export async function bootChat(chatSeed, user) {
    return bootChatShared(chatSeed, user, {
        httpsCallable,
        functions,
        diag: mark,
    });
}

export { lockWallet, lockChat };
