import { useCallback } from 'react';

import { cleanText } from '../utils/text.js';
import { normalizeLightningFeeEstimate, normalizeLightningPaymentResult, toSafeSats } from './fees.js';
import { walletPKtoSparkAddress } from './spark.js';

export function useSparkSend({ wallet, network, updateWalletData, rememberTransfer }) {
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
                await rememberTransfer?.(tx?.id);
                await updateWalletData({ reason: 'send' });
                return tx?.id;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`failed to send money: ${message}`, { cause: error });
            }
        },
        [wallet, network, updateWalletData, rememberTransfer]
    );
}

function firstSparkInvoiceError(result) {
    return result?.invalidInvoices?.[0]?.error || result?.satsTransactionErrors?.[0]?.error || result?.tokenTransactionErrors?.[0]?.error || null;
}

function firstSparkInvoiceSuccess(result) {
    return result?.satsTransactionSuccess?.[0]?.transferResponse || result?.tokenTransactionSuccess?.[0] || null;
}

export function useExternalPayment({ wallet, updateWalletData, rememberTransfer }) {
    return useCallback(
        async ({ type, invoice, amountSats, variableAmount = false } = {}) => {
            if (!wallet) {
                throw new Error('wallet not ready');
            }

            const value = cleanText(invoice);
            if (!value) {
                throw new Error('invoice required');
            }

            if (type === 'lightning') {
                const sendAmountSats = variableAmount ? toSafeSats(amountSats, 'amountSatsToSend') : null;
                const estimateParams = {
                    encodedInvoice: value,
                    ...(sendAmountSats != null ? { amountSats: sendAmountSats } : {}),
                };
                const feeAmountSats = await wallet.getLightningSendFeeEstimate(estimateParams);
                const fees = normalizeLightningFeeEstimate(feeAmountSats);
                const payment = await wallet.payLightningInvoice({
                    invoice: value,
                    maxFeeSats: fees.feeAmountSats,
                    preferSpark: true,
                    ...(sendAmountSats != null ? { amountSatsToSend: sendAmountSats } : {}),
                });
                const result = normalizeLightningPaymentResult(payment);
                await rememberTransfer?.(result?.id || payment?.id);
                await updateWalletData({ reason: 'external-lightning-send' });
                return {
                    id: result?.id || payment?.id || null,
                    payment,
                    result,
                    fees,
                };
            }

            if (type === 'spark') {
                const safeAmountSats = amountSats != null ? toSafeSats(amountSats, 'amountSats') : null;
                const result = await wallet.fulfillSparkInvoice([
                    {
                        invoice: value,
                        ...(safeAmountSats != null ? { amount: BigInt(safeAmountSats) } : {}),
                    },
                ]);
                const error = firstSparkInvoiceError(result);
                if (error) {
                    throw error;
                }
                const success = firstSparkInvoiceSuccess(result);
                if (!success) {
                    throw new Error('failed to pay spark invoice');
                }
                const id = success.id || success.txid || null;
                await rememberTransfer?.(id);
                await updateWalletData({ reason: 'external-spark-send' });
                return {
                    id,
                    result,
                };
            }

            throw new Error('unsupported invoice type');
        },
        [wallet, updateWalletData, rememberTransfer]
    );
}
