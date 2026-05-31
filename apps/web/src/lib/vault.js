'use client';

import { SparkWallet } from '@buildonspark/spark-sdk';
import { httpsCallable } from 'firebase/functions';
import { getFunctions } from '@/lib/firebase/firebaseclient';
import { resolveNetwork } from '@veyl/shared/network';
import { bootWallet as bootWalletShared, bootChat as bootChatShared, lockWallet, lockChat } from '@veyl/shared/vault';

export async function bootWallet(walletMnemonic, user) {
    return bootWalletShared(walletMnemonic, user, {
        SparkWallet,
        httpsCallable,
        functions: getFunctions(),
        network: resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK }),
    });
}

export async function bootChat(chatSeed, user) {
    return bootChatShared(chatSeed, user, {
        httpsCallable,
        functions: getFunctions(),
    });
}

export { lockWallet, lockChat };
