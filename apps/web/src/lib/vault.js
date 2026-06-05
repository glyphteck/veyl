'use client';

import { SparkWallet } from '@buildonspark/spark-sdk';
import { resolveNetwork } from '@veyl/shared/network';
import { bootWallet as bootWalletShared, bootChat as bootChatShared, lockWallet, lockChat } from '@veyl/shared/vault';
import { cloud } from '@/lib/cloud';

export async function bootWallet(walletMnemonic, user) {
    return bootWalletShared(walletMnemonic, user, {
        SparkWallet,
        cloud,
        network: resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK }),
    });
}

export async function bootChat(chatSeed, user) {
    return bootChatShared(chatSeed, user, {
        cloud,
    });
}

export { lockWallet, lockChat };
