import { useCallback } from 'react';

import { normalizeLightningFeeEstimate, normalizeLightningPaymentResult, normalizeLightningReceiveRequest, toSafeNonNegativeSats, toSafeSats } from './fees.js';

export function useLightning({ wallet, updateWalletData }) {
    const createLightningInvoice = useCallback(
        async ({ amountSats = 0, memo, expirySeconds, includeSparkAddress = false, includeSparkInvoice = false, receiverIdentityPubkey, descriptionHash } = {}) => {
            if (!wallet) {
                return { success: false, error: new Error('wallet not ready') };
            }
            if (memo && descriptionHash) {
                return { success: false, error: new Error('lightning invoice memo and descriptionHash are mutually exclusive') };
            }
            if (includeSparkAddress && includeSparkInvoice) {
                return { success: false, error: new Error('includeSparkAddress and includeSparkInvoice are mutually exclusive') };
            }

            try {
                const safeAmountSats = toSafeNonNegativeSats(amountSats);
                const request = await wallet.createLightningInvoice({
                    amountSats: safeAmountSats,
                    ...(memo ? { memo } : {}),
                    ...(expirySeconds != null ? { expirySeconds } : {}),
                    includeSparkAddress,
                    includeSparkInvoice,
                    ...(receiverIdentityPubkey ? { receiverIdentityPubkey } : {}),
                    ...(descriptionHash ? { descriptionHash } : {}),
                });

                return {
                    success: true,
                    request,
                    invoice: normalizeLightningReceiveRequest(request),
                };
            } catch (error) {
                return { success: false, error };
            }
        },
        [wallet]
    );

    const quoteLightningFees = useCallback(
        async ({ invoice, amountSats } = {}) => {
            if (!wallet) {
                return { success: false, error: new Error('wallet not ready') };
            }

            const encodedInvoice = typeof invoice === 'string' ? invoice.trim() : '';
            if (!encodedInvoice) {
                return { success: false, error: new Error('lightning invoice required') };
            }

            try {
                const params = { encodedInvoice };
                if (amountSats != null) {
                    params.amountSats = toSafeSats(amountSats);
                }

                const feeAmountSats = await wallet.getLightningSendFeeEstimate(params);
                return {
                    success: true,
                    feeAmountSats,
                    fees: normalizeLightningFeeEstimate(feeAmountSats),
                };
            } catch (error) {
                return { success: false, error };
            }
        },
        [wallet]
    );

    const sendLightningPayment = useCallback(
        async ({ invoice, maxFeeSats, preferSpark = false, amountSatsToSend, idempotencyKey } = {}) => {
            if (!wallet) {
                return { success: false, error: new Error('wallet not ready') };
            }

            const encodedInvoice = typeof invoice === 'string' ? invoice.trim() : '';
            if (!encodedInvoice) {
                return { success: false, error: new Error('lightning invoice required') };
            }

            try {
                const params = {
                    invoice: encodedInvoice,
                    maxFeeSats: toSafeNonNegativeSats(maxFeeSats, 'maxFeeSats'),
                    preferSpark: !!preferSpark,
                };
                if (amountSatsToSend != null) {
                    params.amountSatsToSend = toSafeSats(amountSatsToSend, 'amountSatsToSend');
                }
                if (idempotencyKey) {
                    params.idempotencyKey = idempotencyKey;
                }

                const payment = await wallet.payLightningInvoice(params);
                await updateWalletData();
                return {
                    success: true,
                    payment,
                    result: normalizeLightningPaymentResult(payment),
                };
            } catch (error) {
                return { success: false, error };
            }
        },
        [wallet, updateWalletData]
    );

    const getLightningReceiveRequest = useCallback(
        async (id) => {
            if (!wallet) {
                return { success: false, error: new Error('wallet not ready') };
            }

            const requestId = typeof id === 'string' ? id.trim() : '';
            if (!requestId) {
                return { success: false, error: new Error('lightning receive request id required') };
            }

            try {
                const request = await wallet.getLightningReceiveRequest(requestId);
                return {
                    success: true,
                    request,
                    invoice: normalizeLightningReceiveRequest(request),
                };
            } catch (error) {
                return { success: false, error };
            }
        },
        [wallet]
    );

    const getLightningSendRequest = useCallback(
        async (id) => {
            if (!wallet) {
                return { success: false, error: new Error('wallet not ready') };
            }

            const requestId = typeof id === 'string' ? id.trim() : '';
            if (!requestId) {
                return { success: false, error: new Error('lightning send request id required') };
            }

            try {
                const request = await wallet.getLightningSendRequest(requestId);
                return {
                    success: true,
                    request,
                    result: normalizeLightningPaymentResult(request),
                };
            } catch (error) {
                return { success: false, error };
            }
        },
        [wallet]
    );

    return {
        createLightningInvoice,
        quoteLightningFees,
        sendLightningPayment,
        getLightningReceiveRequest,
        getLightningSendRequest,
    };
}
