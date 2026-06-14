import { useCallback } from 'react';

import { isAddressOnNetwork } from '../network.js';
import { cleanText } from '../utils/text.js';
import { DEFAULT_EXIT_SPEED, getExitSpeed, getWithdrawalFeeAmountSats, normalizeWithdrawalFeeQuote, toSafeNonNegativeSats, toSafeSats } from './fees.js';

function getWithdrawalReview({ feeQuote, exitSpeed, amountSats, onchainAddress, deductFeeFromWithdrawalAmount = true }) {
    const safeExitSpeed = getExitSpeed(exitSpeed);
    const feeQuoteId = feeQuote?.id ?? null;
    const feeAmountSats = getWithdrawalFeeAmountSats(feeQuote, safeExitSpeed);
    if (!feeQuoteId || feeAmountSats == null) {
        throw new Error('withdrawal fee quote unavailable');
    }

    const sparkFees = normalizeWithdrawalFeeQuote(feeQuote);
    const withdrawal = {
        kind: 'cooperative_exit',
        onchainAddress,
        amountSats,
        exitSpeed: safeExitSpeed,
        deductFeeFromWithdrawalAmount,
        feeQuote,
        feeQuoteId,
        feeAmountSats,
        fees: {
            spark: sparkFees,
        },
        sparkFees,
        expiresAt: sparkFees?.expiresAt ?? feeQuote.expiresAt ?? null,
    };
    assertWithdrawalReceivesFunds(withdrawal);
    return withdrawal;
}

export function getWithdrawalReviewAmounts(withdrawal) {
    const amountSats = toSafeSats(withdrawal?.amountSats);
    const feeAmountSats = toSafeNonNegativeSats(withdrawal?.feeAmountSats ?? 0, 'feeAmountSats');
    const deductFeeFromWithdrawalAmount = withdrawal?.deductFeeFromWithdrawalAmount !== false;
    const receiveAmountSats = deductFeeFromWithdrawalAmount ? Math.max(0, amountSats - feeAmountSats) : amountSats;
    const sendAmountSats = deductFeeFromWithdrawalAmount ? amountSats : amountSats + feeAmountSats;

    return {
        sendAmountSats,
        receiveAmountSats,
        feeAmountSats,
    };
}

function assertWithdrawalReceivesFunds(withdrawal) {
    const { receiveAmountSats } = getWithdrawalReviewAmounts(withdrawal);
    if (receiveAmountSats <= 0) {
        throw new Error('withdrawal fee is greater than or equal to the amount');
    }
}

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

    const prepareWithdrawal = useCallback(
        async ({ onchainAddress, amountSats, exitSpeed = DEFAULT_EXIT_SPEED, deductFeeFromWithdrawalAmount = true } = {}) => {
            const quoted = await quoteWithdrawalFees({ onchainAddress, amountSats });
            if (!quoted.success) {
                return quoted;
            }

            try {
                const withdrawal = getWithdrawalReview({
                    feeQuote: quoted.feeQuote,
                    exitSpeed,
                    amountSats: quoted.amountSats,
                    onchainAddress: quoted.onchainAddress,
                    deductFeeFromWithdrawalAmount,
                });

                return {
                    success: true,
                    withdrawal,
                    ...withdrawal,
                };
            } catch (error) {
                return { success: false, error };
            }
        },
        [quoteWithdrawalFees]
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

                assertWithdrawalReceivesFunds({
                    amountSats: safeAmountSats,
                    feeAmountSats: readyFeeAmountSats,
                    deductFeeFromWithdrawalAmount,
                });

                const tx = await wallet.withdraw({
                    onchainAddress: address,
                    amountSats: safeAmountSats,
                    exitSpeed: safeExitSpeed,
                    feeQuoteId: readyFeeQuoteId,
                    feeAmountSats: readyFeeAmountSats,
                    deductFeeFromWithdrawalAmount,
                });
                await updateWalletData({ reason: 'withdraw' });
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

    const confirmWithdrawal = useCallback(
        async (withdrawal) => {
            if (!withdrawal) {
                return { success: false, error: new Error('withdrawal review missing') };
            }

            return withdrawFunds({
                onchainAddress: withdrawal.onchainAddress,
                amountSats: withdrawal.amountSats,
                exitSpeed: withdrawal.exitSpeed,
                feeQuoteId: withdrawal.feeQuoteId,
                feeAmountSats: withdrawal.feeAmountSats,
                deductFeeFromWithdrawalAmount: withdrawal.deductFeeFromWithdrawalAmount,
            });
        },
        [withdrawFunds]
    );

    return {
        quoteWithdrawalFees,
        prepareWithdrawal,
        confirmWithdrawal,
        withdrawFunds,
    };
}
