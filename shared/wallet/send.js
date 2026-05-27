import { useCallback } from 'react';

import { walletPKtoSparkAddress } from './spark.js';

export function useSparkSend({ wallet, network, updateWalletData }) {
    return useCallback(
        async (receiverWalletPK, amountSats) => {
            if (!wallet) {
                throw new Error('wallet not ready');
            }

            try {
                const receiverSparkAddress = walletPKtoSparkAddress(receiverWalletPK, network);
                const tx = await wallet.transfer({
                    receiverSparkAddress,
                    amountSats: parseInt(amountSats, 10),
                });
                await updateWalletData();
                return tx?.id;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`failed to send money: ${message}`, { cause: error });
            }
        },
        [wallet, network, updateWalletData]
    );
}
