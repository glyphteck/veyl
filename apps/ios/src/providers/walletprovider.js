import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { createWalletProvider } from '@veyl/shared/wallet';
import { resolveNetwork } from '@veyl/shared/network';
import { useVault } from '@/providers/vaultprovider';
import { useUser } from '@/providers/userprovider';
import { mark } from '@/lib/diagnostics';

function useWalletSettings() {
    const { settings } = useUser();
    return settings;
}

const { WalletProvider: BaseWalletProvider, useWallet } = createWalletProvider({
    useVault,
    network: resolveNetwork(globalThis?.process?.env ?? {}),
    appState: AppState,
    useWalletSettings,
    diag: mark,
});

function isSparkClaimTransportError(error) {
    const message = [error?.message, error?.cause?.message, String(error)].filter(Boolean).join(' ');
    return message.includes('/spark.SparkService/query_pending_transfers') && message.includes('Received HTTP 0 response');
}

function WalletRuntime({ children }) {
    const { wallet } = useWallet();
    const activeRef = useRef(AppState.currentState === 'active');

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
        const wrapped = async (...args) => {
            if (!activeRef.current) {
                return [];
            }

            try {
                return await original(...args);
            } catch (error) {
                if (!activeRef.current || isSparkClaimTransportError(error)) {
                    return [];
                }
                throw error;
            }
        };

        wallet.claimTransfers = wrapped;

        if (!activeRef.current) {
            pauseInternalClaims();
        }

        return () => {
            pauseInternalClaims();
            if (wallet.claimTransfers === wrapped) {
                wallet.claimTransfers = original;
            }
        };
    }, [wallet, pauseInternalClaims]);

    useEffect(() => {
        if (!wallet) {
            return;
        }

        const sub = AppState.addEventListener('change', (nextState) => {
            activeRef.current = nextState === 'active';

            if (activeRef.current) {
                resumeInternalClaims();
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
