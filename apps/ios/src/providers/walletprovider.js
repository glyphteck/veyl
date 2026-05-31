import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { createWalletProvider } from '@veyl/shared/wallet';
import { resolveNetwork } from '@veyl/shared/network';
import { useVault } from '@/providers/vaultprovider';
import { useUser } from '@/providers/userprovider';
import { mark } from '@/lib/diagnostics';

const CLAIM_BATCH_SIZE = 3;
const CLAIM_BATCH_DELAY_MS = 50;
const CLAIMABLE_STATUS_CODES = new Set([2, 3, 4, 9, 10]);
const CLAIMABLE_STATUS_NAMES = new Set([
    'TRANSFER_STATUS_SENDER_KEY_TWEAKED',
    'TRANSFER_STATUS_RECEIVER_KEY_TWEAKED',
    'TRANSFER_STATUS_RECEIVER_REFUND_SIGNED',
    'TRANSFER_STATUS_RECEIVER_KEY_TWEAK_LOCKED',
    'TRANSFER_STATUS_RECEIVER_KEY_TWEAK_APPLIED',
]);

function useWalletSettings() {
    const { settings } = useUser();
    return settings;
}

function useWalletIdentity() {
    const { walletPK } = useUser();
    return useMemo(() => ({ walletPK }), [walletPK]);
}

const { WalletProvider: BaseWalletProvider, useWallet } = createWalletProvider({
    useVault,
    network: resolveNetwork(globalThis?.process?.env ?? {}),
    appState: AppState,
    useWalletSettings,
    useWalletIdentity,
    diag: mark,
});

function isSparkClaimTransportError(error) {
    const message = [error?.message, error?.cause?.message, String(error)].filter(Boolean).join(' ');
    return message.includes('/spark.SparkService/query_pending_transfers') && message.includes('Received HTTP 0 response');
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function isClaimableStatus(status) {
    return CLAIMABLE_STATUS_CODES.has(status) || CLAIMABLE_STATUS_NAMES.has(status);
}

function canClaimTransfer(transfer, types) {
    if (types && !types.includes(transfer?.type)) {
        return false;
    }
    return isClaimableStatus(transfer?.status);
}

async function claimTransfersInBatches(wallet, types, emit, activeRef) {
    const queryPendingTransfers = wallet?.transferService?.queryPendingTransfers;
    const claimTransfer = wallet?.claimTransfer;
    if (typeof queryPendingTransfers !== 'function' || typeof claimTransfer !== 'function') {
        throw new Error('Spark claim internals unavailable');
    }

    const page = await queryPendingTransfers.call(wallet.transferService);
    const transfers = (Array.isArray(page?.transfers) ? page.transfers : []).filter((transfer) => canClaimTransfer(transfer, types));
    if (!transfers.length || !activeRef.current) {
        mark('wallet.claim.done', { count: 0 });
        return [];
    }

    mark('wallet.claim.start', { count: transfers.length, batchSize: CLAIM_BATCH_SIZE });
    const claimed = [];
    for (let index = 0; index < transfers.length && activeRef.current; index += CLAIM_BATCH_SIZE) {
        const batch = transfers.slice(index, index + CLAIM_BATCH_SIZE);
        const results = await Promise.allSettled(
            batch.map((transfer) =>
                claimTransfer
                    .call(wallet, { transfer, emit })
                    .then(() => transfer.id)
                    .catch(() => null)
            )
        );
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
                claimed.push(result.value);
            }
        }
        mark('wallet.claim.batch', { claimed: claimed.length, total: transfers.length });
        if (index + CLAIM_BATCH_SIZE < transfers.length && activeRef.current) {
            await delay(CLAIM_BATCH_DELAY_MS);
        }
    }
    mark('wallet.claim.done', { count: claimed.length, total: transfers.length });
    return claimed;
}

function WalletRuntime({ children }) {
    const { wallet } = useWallet();
    const activeRef = useRef(AppState.currentState === 'active');
    const claimPromiseRef = useRef(null);

    const pauseInternalClaims = useCallback(() => {
        if (!wallet?.claimTransfersInterval) {
            return;
        }

        clearInterval(wallet.claimTransfersInterval);
        wallet.claimTransfersInterval = null;
    }, [wallet]);

    const resumeInternalClaims = useCallback(() => {
        if (typeof wallet?.startPeriodicClaimTransfers !== 'function' || !activeRef.current) {
            return;
        }

        try {
            const promise = wallet.startPeriodicClaimTransfers();
            promise?.catch?.(() => {});
        } catch {}
    }, [wallet]);

    useEffect(() => {
        activeRef.current = AppState.currentState === 'active';
    }, []);

    useEffect(() => {
        if (!wallet || typeof wallet.claimTransfers !== 'function') {
            return;
        }

        const original = wallet.claimTransfers.bind(wallet);
        const wrapped = async (types, emit) => {
            if (!activeRef.current) {
                return [];
            }
            if (claimPromiseRef.current) {
                return claimPromiseRef.current;
            }

            try {
                claimPromiseRef.current = claimTransfersInBatches(wallet, types, emit, activeRef).finally(() => {
                    claimPromiseRef.current = null;
                });
                return await claimPromiseRef.current;
            } catch (error) {
                if (!activeRef.current || isSparkClaimTransportError(error)) {
                    return [];
                }
                throw error;
            }
        };

        wallet.claimTransfers = wrapped;

        if (activeRef.current) {
            resumeInternalClaims();
            void wrapped();
        } else {
            pauseInternalClaims();
        }

        return () => {
            pauseInternalClaims();
            if (wallet.claimTransfers === wrapped) {
                wallet.claimTransfers = original;
            }
        };
    }, [wallet, pauseInternalClaims, resumeInternalClaims]);

    useEffect(() => {
        if (!wallet) {
            return;
        }

        const sub = AppState.addEventListener('change', (nextState) => {
            activeRef.current = nextState === 'active';

            if (activeRef.current) {
                resumeInternalClaims();
                void wallet.claimTransfers?.();
                return;
            }

            pauseInternalClaims();
        });

        return () => sub?.remove?.();
    }, [wallet, pauseInternalClaims, resumeInternalClaims]);

    return children;
}

function WalletProvider({ children }) {
    return (
        <BaseWalletProvider>
            <WalletRuntime>{children}</WalletRuntime>
        </BaseWalletProvider>
    );
}

export { WalletProvider, useWallet };
