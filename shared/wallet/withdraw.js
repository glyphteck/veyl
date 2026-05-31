import { useCallback } from 'react';

import { isAddressOnNetwork } from '../network.js';
import { cleanText } from '../utils/text.js';
import { DEFAULT_EXIT_SPEED, getExitSpeed, getWithdrawalFeeAmountSats, normalizeWithdrawalFeeQuote, toSafeNonNegativeSats, toSafeSats } from './fees.js';

export function useWithdrawal({ wallet, network, updateWalletData }) {
    const quoteWithdrawalFees = useCallback(
        async ({ onchainAddress, amountSats } = {}) => {
            if (!wallet) {
                return { success: false, error: new Error('wallet not ready') };
            }

            const address = cleanText(onchainAddress);
            if (!isAddressOnNetwork(address, network)) {
                return { success: false, error: new Error(`refusing to withdraw — address is not a ${network} address`) };
            }

            try {
                const safeAmountSats = toSafeSats(amountSats);
                const feeQuote = await wallet.getWithdrawalFeeQuote({
                    amountSats: safeAmountSats,
                    withdrawalAddress: address,
                });
                if (!feeQuote?.id) {
                    throw new Error('withdrawal fee quote unavailable');
                }

                const sparkFees = normalizeWithdrawalFeeQuote(feeQuote);
                return {
                    success: true,
                    feeQuote,
                    fees: {
                        spark: sparkFees,
                    },
                    sparkFees,
                    amountSats: safeAmountSats,
                    onchainAddress: address,
                };
            } catch (error) {
                return { success: false, error };
            }
        },
        [wallet, network]
    );

    const withdrawFunds = useCallback(
        async ({ onchainAddress, amountSats, exitSpeed = DEFAULT_EXIT_SPEED, feeQuote = null, feeQuoteId = null, feeAmountSats = null, deductFeeFromWithdrawalAmount = true }) => {
            if (!wallet) {
                return { success: false, error: new Error('wallet not ready') };
            }
            const address = cleanText(onchainAddress);
            if (!isAddressOnNetwork(address, network)) {
                return { success: false, error: new Error(`refusing to withdraw — address is not a ${network} address`) };
            }

            try {
                const safeAmountSats = toSafeSats(amountSats);
                const safeExitSpeed = getExitSpeed(exitSpeed);
                let readyFeeQuote = feeQuote;

                if (!readyFeeQuote && (!feeQuoteId || feeAmountSats == null)) {
                    const quoted = await quoteWithdrawalFees({
                        onchainAddress: address,
                        amountSats: safeAmountSats,
                    });
                    if (!quoted.success) {
                        return quoted;
                    }
                    readyFeeQuote = quoted.feeQuote;
                }

                const readyFeeQuoteId = feeQuoteId || readyFeeQuote?.id;
                const readyFeeAmountSats = feeAmountSats == null ? getWithdrawalFeeAmountSats(readyFeeQuote, safeExitSpeed) : toSafeNonNegativeSats(feeAmountSats, 'feeAmountSats');

                if (!readyFeeQuoteId || readyFeeAmountSats == null) {
                    throw new Error('withdrawal fee quote unavailable');
                }

                const tx = await wallet.withdraw({
                    onchainAddress: address,
                    amountSats: safeAmountSats,
                    exitSpeed: safeExitSpeed,
                    feeQuoteId: readyFeeQuoteId,
                    feeAmountSats: readyFeeAmountSats,
                    deductFeeFromWithdrawalAmount,
                });
                await updateWalletData();
                return {
                    success: true,
                    tx,
                    feeQuote: readyFeeQuote,
                    fees: readyFeeQuote
                        ? {
                              spark: normalizeWithdrawalFeeQuote(readyFeeQuote),
                          }
                        : null,
                    feeAmountSats: readyFeeAmountSats,
                };
            } catch (error) {
                return { success: false, error };
            }
        },
        [wallet, network, quoteWithdrawalFees, updateWalletData]
    );

    return {
        quoteWithdrawalFees,
        withdrawFunds,
    };
}
