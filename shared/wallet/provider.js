'use client';

import { createContext, useContext, useEffect, useMemo } from 'react';

import { useWalletBalance } from './balance.js';
import { useDepositClaims } from './claims.js';
import { useFundingAddress } from './funding.js';
import { useLightning } from './lightning.js';
import { useWalletBoot, useWalletData, useWalletEvents, useWalletPolling, useWalletReadyDiag } from './lifecycle.js';
import { useWalletPrivacy } from './privacy.js';
import { useSparkSend } from './send.js';
import { useWalletTransfers } from './transfers.js';
import { useWithdrawal } from './withdraw.js';

export { walletPKtoSparkAddress } from './spark.js';
export {
    COOPERATIVE_EXIT_FLAT_FEE_SATS,
    COOPERATIVE_EXIT_TX_VBYTES,
    DEFAULT_EXIT_SPEED,
    EXIT_SPEEDS,
    FUNDING_TX_PREVIEW_VBYTES,
    STATIC_DEPOSIT_CLAIM_FEE_SATS,
    UNILATERAL_EXIT_FEE_BUMP_TX_VBYTES,
    UNILATERAL_EXIT_MIN_LEAF_SATS,
    UNILATERAL_EXIT_PACKAGES_PER_LEAF,
    UNILATERAL_EXIT_PARENT_TX_FALLBACK_VBYTES,
    UNILATERAL_EXIT_PREVIEW_VBYTES,
    WITHDRAWAL_FEE_WARNING_RATIO,
    estimateOnchainFeeSats,
    estimateUnilateralExitFeeSats,
    getFeeRateSatsPerVbyte,
    getWithdrawalFeeRisk,
    getWithdrawalFeeAmountSats,
    getExpectedVbytes,
    weightUnitsToVbytes,
    normalizeOnchainFeeEstimate,
    normalizeUnilateralExitFeeEstimate,
    normalizeLightningFeeEstimate,
    normalizeLightningPaymentResult,
    normalizeLightningReceiveRequest,
    normalizeStaticDepositQuote,
    normalizeWithdrawalFeeQuote,
} from './fees.js';

const EMPTY_EXTRAS = Object.freeze({});
const EMPTY_WALLET_SETTINGS = Object.freeze({ ghostWallet: true });
const EMPTY_WALLET_IDENTITY = Object.freeze({ walletPK: null });

export function createWalletProvider({
    useVault,
    network,
    appState,
    useWalletExtras = () => EMPTY_EXTRAS,
    useWalletSettings = () => EMPTY_WALLET_SETTINGS,
    useWalletIdentity = () => EMPTY_WALLET_IDENTITY,
    diag = null,
}) {
    if (typeof useVault !== 'function') {
        throw new Error('createWalletProvider requires useVault');
    }

    const WalletContext = createContext(null);

    function WalletProvider({ children }) {
        const { wallet, localCache } = useVault();
        const walletSettings = useWalletSettings() || EMPTY_WALLET_SETTINGS;
        const walletIdentity = useWalletIdentity() || EMPTY_WALLET_IDENTITY;
        const ghostWallet = walletSettings?.ghostWallet === true;

        useWalletPrivacy({ wallet, ghostWallet, diag });

        const balanceState = useWalletBalance({ wallet, diag });
        const transferState = useWalletTransfers({ wallet, walletPK: walletIdentity.walletPK, localCache, diag });
        const fundingState = useFundingAddress({ wallet, diag });
        const updateWalletData = useWalletData({
            wallet,
            getBalance: balanceState.getBalance,
            getRecentTxs: transferState.getRecentTxs,
            diag,
        });

        useWalletEvents({
            wallet,
            updateWalletData,
            setBalance: balanceState.setBalance,
            setTokenBalances: balanceState.setTokenBalances,
            setSatsBalanceResult: balanceState.setSatsBalanceResult,
            diag,
        });

        const claimState = useDepositClaims({
            wallet,
            getFundingAddress: fundingState.getFundingAddress,
            updateWalletData,
            diag,
        });

        const stopPoll = useWalletPolling({
            wallet,
            appState,
            hasPendingTxs: transferState.hasPendingTxs,
            updateWalletData,
            refreshWallet: claimState.refreshWallet,
            refreshClaims: claimState.refreshClaims,
        });

        useWalletBoot({
            wallet,
            getFundingAddress: fundingState.getFundingAddress,
            getBalance: balanceState.getBalance,
            getRecentTxs: transferState.getRecentTxs,
            ensureTxCoverage: transferState.ensureTxCoverage,
            stopPoll,
            diag,
        });

        useWalletReadyDiag({
            wallet,
            balance: balanceState.balance,
            balanceReady: balanceState.balanceReady,
            txReady: transferState.txReady,
            transferCount: transferState.transferCount,
            diag,
        });

        const sendMoneyWithSpark = useSparkSend({ wallet, network, updateWalletData });
        const lightning = useLightning({ wallet, updateWalletData });
        const withdrawal = useWithdrawal({ wallet, network, updateWalletData });

        const extras =
            useWalletExtras({
                wallet,
                balance: balanceState.balance,
                satsBalance: balanceState.satsBalance,
                tokenBalances: balanceState.tokenBalances,
                transfers: transferState.transfers,
                fundingAddress: fundingState.fundingAddress,
                getFundingAddress: fundingState.getFundingAddress,
                refresh: claimState.refreshWallet,
            }) || EMPTY_EXTRAS;

        useEffect(() => {
            if (wallet) {
                return;
            }

            stopPoll();
            balanceState.resetBalance();
            transferState.resetTransfers();
            fundingState.resetFundingAddress();
            claimState.resetClaims();
        }, [wallet, stopPoll, balanceState.resetBalance, transferState.resetTransfers, fundingState.resetFundingAddress, claimState.resetClaims]);

        const value = useMemo(
            () => ({
                wallet,
                network,
                balance: balanceState.balance,
                satsBalance: balanceState.satsBalance,
                tokenBalances: balanceState.tokenBalances,
                transfers: transferState.transfers,
                historyTransfers: transferState.historyTransfers,
                fundingAddress: fundingState.fundingAddress,
                balanceReady: balanceState.balanceReady,
                txReady: transferState.txReady,
                isBalanceLoading: balanceState.isBalanceLoading,
                isTxLoading: transferState.isTxLoading,
                oldestTxMs: transferState.oldestLoadedMs,
                oldestKnownTxMs: transferState.oldestKnownTxMs,
                oldestVerifiedTxMs: transferState.oldestVerifiedTxMs,
                txHistoryComplete: transferState.historyComplete,
                txServerHistoryComplete: transferState.serverHistoryComplete,
                historyTransferCount: transferState.historyTransferCount,
                hasMoreTxs: transferState.hasMoreTxs,
                isWalletDataReady: !!wallet,
                isWalletDataLoaded: !!wallet && balanceState.balanceReady && transferState.txReady,
                ensureTxCoverage: transferState.ensureTxCoverage,
                loadMoreTxs: transferState.loadMoreTxs,
                refresh: claimState.refreshWallet,
                claimDeposits: claimState.claimDeposits,
                getFundingAddress: fundingState.getFundingAddress,
                sendMoneyWithSpark,
                createLightningInvoice: lightning.createLightningInvoice,
                quoteLightningFees: lightning.quoteLightningFees,
                sendLightningPayment: lightning.sendLightningPayment,
                getLightningReceiveRequest: lightning.getLightningReceiveRequest,
                getLightningSendRequest: lightning.getLightningSendRequest,
                quoteWithdrawalFees: withdrawal.quoteWithdrawalFees,
                prepareWithdrawal: withdrawal.prepareWithdrawal,
                confirmWithdrawal: withdrawal.confirmWithdrawal,
                withdrawFunds: withdrawal.withdrawFunds,
                ...extras,
            }),
            [
                wallet,
                network,
                balanceState.balance,
                balanceState.satsBalance,
                balanceState.tokenBalances,
                transferState.transfers,
                transferState.historyTransfers,
                fundingState.fundingAddress,
                balanceState.balanceReady,
                transferState.txReady,
                balanceState.isBalanceLoading,
                transferState.isTxLoading,
                transferState.oldestLoadedMs,
                transferState.oldestKnownTxMs,
                transferState.oldestVerifiedTxMs,
                transferState.historyComplete,
                transferState.serverHistoryComplete,
                transferState.historyTransferCount,
                transferState.hasMoreTxs,
                claimState.refreshWallet,
                claimState.claimDeposits,
                fundingState.getFundingAddress,
                transferState.ensureTxCoverage,
                transferState.loadMoreTxs,
                sendMoneyWithSpark,
                lightning.createLightningInvoice,
                lightning.quoteLightningFees,
                lightning.sendLightningPayment,
                lightning.getLightningReceiveRequest,
                lightning.getLightningSendRequest,
                withdrawal.quoteWithdrawalFees,
                withdrawal.prepareWithdrawal,
                withdrawal.confirmWithdrawal,
                withdrawal.withdrawFunds,
                extras,
            ]
        );

        return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
    }

    function useWallet() {
        const context = useContext(WalletContext);
        if (!context) {
            throw new Error('useWallet must be used within a WalletProvider');
        }
        return context;
    }

    return { WalletProvider, useWallet, WalletContext };
}
