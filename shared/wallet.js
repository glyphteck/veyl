'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { readCachedTransfers, writeCachedTransfers } from './localdatacache.js';
import { walletPKtoSparkAddress } from './spark.js';
import { isAddressOnNetwork } from './network.js';

export { walletPKtoSparkAddress } from './spark.js';

const RATE_LIMIT = 5 * 1000;
const POLL_TXS_RATE = 10 * 1000;
const UPDATE_BTC_DATA_RATE = 15 * 60 * 1000;
const ACTIVE_CLAIM_RATE = 20 * 1000;
const AUTO_CLAIM_MAX_FEE_SATS = 5000;
const CLAIM_PAGE_SIZE = 100;
const RECENT_TRANSFER_LIMIT = 50;
const INITIAL_TRANSFER_LIMIT = RECENT_TRANSFER_LIMIT;
const EMPTY_EXTRAS = Object.freeze({});
const WALLET_EVENTS = Object.freeze({
    balance: 'balance:update',
    tokenBalance: 'token-balance:update',
    transferClaimed: 'transfer:claimed',
    depositConfirmed: 'deposit:confirmed',
});
const FINAL_TRANSFER_STATUSES = new Set(['TRANSFER_STATUS_COMPLETED', 'TRANSFER_STATUS_EXPIRED', 'TRANSFER_STATUS_RETURNED', 'UNRECOGNIZED']);

function getBalanceValue(result) {
    return result?.satsBalance?.available ?? result?.balance ?? null;
}

function getTokenBalances(result) {
    return result?.tokenBalances instanceof Map ? result.tokenBalances : null;
}

function getSatsBalance(result) {
    const satsBalance = result?.satsBalance;
    if (!satsBalance || typeof satsBalance !== 'object') {
        return null;
    }
    return satsBalance;
}

function getWithdrawalFeeAmountSats(feeQuote, exitSpeed) {
    const speed = String(exitSpeed || '').toLowerCase();
    const userFee = feeQuote?.[`userFee${speed.charAt(0).toUpperCase()}${speed.slice(1)}`]?.originalValue ?? 0;
    const l1Fee = feeQuote?.[`l1BroadcastFee${speed.charAt(0).toUpperCase()}${speed.slice(1)}`]?.originalValue ?? 0;
    return Number(userFee) + Number(l1Fee);
}

function clearTimer(ref) {
    if (!ref.current) {
        return;
    }
    clearInterval(ref.current);
    ref.current = null;
}

function isPendingTransfer(tx) {
    const status = typeof tx?.status === 'string' ? tx.status : '';
    return !!status && !FINAL_TRANSFER_STATUSES.has(status);
}

function sameTransfers(a = [], b = []) {
    if (a === b) {
        return true;
    }

    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
    }

    for (let i = 0; i < a.length; i++) {
        const left = a[i];
        const right = b[i];
        if (
            left?.id !== right?.id ||
            left?.status !== right?.status ||
            left?.createdTime !== right?.createdTime ||
            left?.totalValue !== right?.totalValue ||
            left?.type !== right?.type ||
            left?.transferDirection !== right?.transferDirection ||
            left?.senderIdentityPublicKey !== right?.senderIdentityPublicKey ||
            left?.receiverIdentityPublicKey !== right?.receiverIdentityPublicKey
        ) {
            return false;
        }
    }

    return true;
}

function sameTransferForSync(a, b) {
    return sameTransfers(a ? [a] : [], b ? [b] : []);
}

async function getAddressDepositUtxos(wallet, getFundingAddress) {
    const address = await getFundingAddress();
    if (!address) {
        return [];
    }

    const utxos = [];
    let offset = 0;

    while (true) {
        const page = await wallet.getUtxosForDepositAddress(address, CLAIM_PAGE_SIZE, offset, true);
        if (!Array.isArray(page) || !page.length) {
            break;
        }

        utxos.push(...page);
        if (page.length < CLAIM_PAGE_SIZE) {
            break;
        }

        offset += page.length;
    }

    return utxos;
}

async function getClaimableDepositUtxos(wallet, getFundingAddress) {
    if (typeof wallet?.getUtxosForIdentity !== 'function') {
        return getAddressDepositUtxos(wallet, getFundingAddress);
    }

    try {
        const utxos = [];
        let cursor = '';

        while (true) {
            const page = await wallet.getUtxosForIdentity({
                pageSize: CLAIM_PAGE_SIZE,
                cursor,
                excludeClaimed: true,
                includePending: false,
            });
            const pageUtxos = Array.isArray(page?.utxos) ? page.utxos.filter((utxo) => utxo?.isConfirmed !== false) : [];
            utxos.push(...pageUtxos);

            const nextCursor = page?.pageResponse?.nextCursor || '';
            if (!page?.pageResponse?.hasNextPage || !nextCursor || nextCursor === cursor) {
                break;
            }
            cursor = nextCursor;
        }

        return utxos;
    } catch {
        return getAddressDepositUtxos(wallet, getFundingAddress);
    }
}

export function createWalletProvider({ useVault, db, network, appState, useWalletExtras = () => EMPTY_EXTRAS }) {
    if (typeof useVault !== 'function') {
        throw new Error('createWalletProvider requires useVault');
    }
    if (!db) {
        throw new Error('createWalletProvider requires db');
    }

    const WalletContext = createContext(null);

    function WalletProvider({ children }) {
        const { wallet, localCache } = useVault();

        const [balance, setBalance] = useState(null);
        const [satsBalance, setSatsBalance] = useState(null);
        const [tokenBalances, setTokenBalances] = useState(() => new Map());
        const [transfers, setTransfers] = useState([]);
        const [bitcoin, setBitcoin] = useState({ price: null, block: null });
        const [fundingAddress, setFundingAddress] = useState(null);
        const [balanceReady, setBalanceReady] = useState(false);
        const [txReady, setTxReady] = useState(false);
        const [isBalanceLoading, setIsBalanceLoading] = useState(false);
        const [isTxLoading, setIsTxLoading] = useState(false);

        const lastFetchTime = useRef(0);
        const pollIntervalRef = useRef(null);
        const claimPromiseRef = useRef(null);
        const fundingAddressPromiseRef = useRef(null);
        const transfersRef = useRef([]);
        const hasPendingTxs = transfers.slice(0, RECENT_TRANSFER_LIMIT).some(isPendingTransfer);

        const isActive = useCallback(() => {
            return !appState?.currentState || appState.currentState === 'active';
        }, [appState]);

        const setBalanceResult = useCallback((result) => {
            const nextBalance = getBalanceValue(result);
            if (nextBalance != null) {
                setBalance(nextBalance);
            }

            const nextSatsBalance = getSatsBalance(result);
            if (nextSatsBalance) {
                setSatsBalance(nextSatsBalance);
            }

            const nextTokenBalances = getTokenBalances(result);
            if (nextTokenBalances) {
                setTokenBalances(new Map(nextTokenBalances));
            }
        }, []);

        const setSatsBalanceResult = useCallback((nextSatsBalance) => {
            if (!nextSatsBalance || typeof nextSatsBalance !== 'object') {
                return;
            }

            setSatsBalance(nextSatsBalance);
            if (nextSatsBalance.available != null) {
                setBalance(nextSatsBalance.available);
            }
        }, []);

        useEffect(() => {
            transfersRef.current = transfers;
        }, [transfers]);

        const getBalance = useCallback(async () => {
            if (!wallet) {
                return;
            }

            setIsBalanceLoading(true);
            try {
                const result = await wallet.getBalance();
                setBalanceResult(result);
            } catch (error) {
                console.debug?.('could not get balance', error?.message ?? error);
            } finally {
                setBalanceReady(true);
                setIsBalanceLoading(false);
            }
        }, [wallet, setBalanceResult]);

        const setNextTransfers = useCallback((latestTransfers = []) => {
            setTransfers((currentTransfers) => {
                if (!currentTransfers.length) {
                    return latestTransfers;
                }

                const recentIds = new Set(latestTransfers.map((tx) => tx.id));
                const nextTransfers = [...latestTransfers];
                for (const tx of currentTransfers) {
                    if (!recentIds.has(tx.id)) {
                        nextTransfers.push(tx);
                    }
                }
                return sameTransfers(currentTransfers, nextTransfers) ? currentTransfers : nextTransfers;
            });
        }, []);

        const getRecentTxs = useCallback(async () => {
            if (!wallet) {
                return null;
            }

            setIsTxLoading(true);
            try {
                const page = await wallet.getTransfers(INITIAL_TRANSFER_LIMIT, 0);
                const latestTransfers = Array.isArray(page?.transfers) ? page.transfers : [];
                setNextTransfers(latestTransfers);
                const result = {
                    transfers: latestTransfers,
                    offset: page?.offset,
                    hasMore: latestTransfers.length >= INITIAL_TRANSFER_LIMIT && page?.offset != null,
                };
                return result;
            } catch (error) {
                console.debug?.('could not get recent transfers', error?.message ?? error);
                return null;
            } finally {
                setTxReady(true);
                setIsTxLoading(false);
            }
        }, [wallet, setNextTransfers]);

        const updateWalletData = useCallback(
            async (force = false) => {
                if (!wallet) {
                    return;
                }

                const now = Date.now();
                if (!force && now - lastFetchTime.current < RATE_LIMIT) {
                    return;
                }

                lastFetchTime.current = now;
                await Promise.all([getBalance(), getRecentTxs()]);
            },
            [wallet, getBalance, getRecentTxs]
        );

        const getAllTxs = useCallback(
            async (firstPage = null) => {
                if (!wallet) {
                    return;
                }

                setIsTxLoading(true);
                try {
                    const limit = RECENT_TRANSFER_LIMIT;
                    const seededTransfers = Array.isArray(firstPage?.transfers) ? firstPage.transfers : [];
                    const cachedTransfers = transfersRef.current;
                    const cachedById = new Map(cachedTransfers.filter((tx) => tx?.id).map((tx) => [tx.id, tx]));
                    const pendingCachedIds = new Set(cachedTransfers.filter(isPendingTransfer).map((tx) => tx.id).filter(Boolean));
                    let offset = firstPage?.offset ?? 0;
                    const nextTransfers = [];
                    let shouldFetch = !firstPage || firstPage.hasMore;
                    let reachedCacheBoundary = false;

                    const appendPage = (pageTransfers = []) => {
                        let reachedStableCachedBoundary = false;
                        for (const tx of pageTransfers) {
                            if (!tx?.id) {
                                continue;
                            }

                            nextTransfers.push(tx);
                            pendingCachedIds.delete(tx.id);

                            const cached = cachedById.get(tx.id);
                            if (cached && sameTransferForSync(tx, cached)) {
                                reachedStableCachedBoundary = true;
                            }
                        }
                        return reachedStableCachedBoundary && pendingCachedIds.size === 0;
                    };

                    if (appendPage(seededTransfers)) {
                        reachedCacheBoundary = true;
                        shouldFetch = false;
                    }

                    while (shouldFetch) {
                        const { transfers: txs = [], offset: nextOffset } = await wallet.getTransfers(limit, offset);
                        if (appendPage(txs)) {
                            reachedCacheBoundary = true;
                            break;
                        }
                        if (txs.length < limit) {
                            break;
                        }
                        if (nextOffset == null || nextOffset === offset) {
                            break;
                        }
                        offset = nextOffset;
                        shouldFetch = true;
                    }
                    if (reachedCacheBoundary) {
                        setNextTransfers(nextTransfers);
                    } else {
                        setTransfers((currentTransfers) => (sameTransfers(currentTransfers, nextTransfers) ? currentTransfers : nextTransfers));
                    }
                } catch (error) {
                    console.debug?.('could not get all transfers', error?.message ?? error);
                } finally {
                    setTxReady(true);
                    setIsTxLoading(false);
                }
            },
            [wallet, setNextTransfers]
        );

        const getFundingAddress = useCallback(async () => {
            if (!wallet) {
                return null;
            }
            if (fundingAddress) {
                return fundingAddress;
            }

            if (fundingAddressPromiseRef.current) {
                return fundingAddressPromiseRef.current;
            }

            fundingAddressPromiseRef.current = wallet
                .getStaticDepositAddress()
                .then((address) => {
                    setFundingAddress(address);
                    return address;
                })
                .finally(() => {
                    fundingAddressPromiseRef.current = null;
                });

            return fundingAddressPromiseRef.current;
        }, [wallet, fundingAddress]);

        const claimDeposits = useCallback(async () => {
            if (!wallet) {
                return false;
            }

            if (claimPromiseRef.current) {
                return claimPromiseRef.current;
            }

            claimPromiseRef.current = (async () => {
                try {
                    const utxos = await getClaimableDepositUtxos(wallet, getFundingAddress);
                    if (!utxos.length) {
                        return false;
                    }

                    let claimed = false;
                    const seen = new Set();

                    for (const utxo of utxos) {
                        if (!utxo?.txid || !Number.isInteger(utxo.vout)) {
                            continue;
                        }

                        const key = `${utxo.txid}:${utxo.vout}`;
                        if (seen.has(key)) {
                            continue;
                        }
                        seen.add(key);

                        try {
                            const claim = await wallet.claimStaticDepositWithMaxFee({
                                transactionId: utxo.txid,
                                outputIndex: utxo.vout,
                                maxFee: AUTO_CLAIM_MAX_FEE_SATS,
                            });
                            if (claim) {
                                claimed = true;
                            }
                        } catch (error) {
                            console.debug?.('could not claim deposit', key, error?.message ?? error);
                        }
                    }

                    return claimed;
                } catch (error) {
                    console.debug?.('could not check deposits', error?.message ?? error);
                    return false;
                } finally {
                    claimPromiseRef.current = null;
                }
            })();

            return claimPromiseRef.current;
        }, [wallet, getFundingAddress]);

        useEffect(() => {
            if (!wallet || typeof wallet.on !== 'function' || typeof wallet.off !== 'function') {
                return;
            }

            const handleTokenBalanceUpdate = (event) => {
                if (event?.tokenBalances instanceof Map) {
                    setTokenBalances(new Map(event.tokenBalances));
                }
            };

            const handleBalanceUpdate = (nextSatsBalance) => {
                setSatsBalanceResult(nextSatsBalance);
            };

            const handleIncomingFunds = async (_id, updatedBalance) => {
                if (updatedBalance != null) {
                    setBalance(updatedBalance);
                }
                await updateWalletData(true);
            };

            wallet.on(WALLET_EVENTS.balance, handleBalanceUpdate);
            wallet.on(WALLET_EVENTS.tokenBalance, handleTokenBalanceUpdate);
            wallet.on(WALLET_EVENTS.depositConfirmed, handleIncomingFunds);
            wallet.on(WALLET_EVENTS.transferClaimed, handleIncomingFunds);

            return () => {
                wallet.off(WALLET_EVENTS.balance, handleBalanceUpdate);
                wallet.off(WALLET_EVENTS.tokenBalance, handleTokenBalanceUpdate);
                wallet.off(WALLET_EVENTS.depositConfirmed, handleIncomingFunds);
                wallet.off(WALLET_EVENTS.transferClaimed, handleIncomingFunds);
            };
        }, [wallet, updateWalletData, setSatsBalanceResult]);

        const refreshWallet = useCallback(async () => {
            const claimed = await claimDeposits();
            if (claimed) {
                await getAllTxs();
            }
            await updateWalletData(true);
        }, [claimDeposits, getAllTxs, updateWalletData]);

        const refreshClaims = useCallback(async () => {
            const claimed = await claimDeposits();
            if (!claimed) {
                return false;
            }

            await getAllTxs();
            await updateWalletData(true);
            return true;
        }, [claimDeposits, getAllTxs, updateWalletData]);

        const startPoll = useCallback(() => {
            if (pollIntervalRef.current || !wallet || !hasPendingTxs || !isActive()) {
                return;
            }

            pollIntervalRef.current = setInterval(() => {
                if (!isActive()) {
                    return;
                }

                void updateWalletData();
            }, POLL_TXS_RATE);
        }, [wallet, hasPendingTxs, isActive, updateWalletData]);

        const stopPoll = useCallback(() => {
            clearTimer(pollIntervalRef);
        }, []);

        const sendMoneyWithSpark = useCallback(
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

        const withdrawFunds = useCallback(
            async ({ onchainAddress, amountSats, exitSpeed }) => {
                if (!wallet) {
                    return { success: false, error: new Error('wallet not ready') };
                }
                if (!isAddressOnNetwork(onchainAddress, network)) {
                    return { success: false, error: new Error(`refusing to withdraw — address is not a ${network} address`) };
                }

                try {
                    const feeQuote = await wallet.getWithdrawalFeeQuote({
                        amountSats,
                        withdrawalAddress: onchainAddress,
                    });
                    if (!feeQuote?.id) {
                        throw new Error('withdrawal fee quote unavailable');
                    }
                    const tx = await wallet.withdraw({
                        onchainAddress,
                        amountSats,
                        exitSpeed,
                        feeQuoteId: feeQuote.id,
                        feeAmountSats: getWithdrawalFeeAmountSats(feeQuote, exitSpeed),
                        deductFeeFromWithdrawalAmount: true,
                    });
                    await updateWalletData();
                    return { success: true, tx };
                } catch (error) {
                    return { success: false, error };
                }
            },
            [wallet, network, updateWalletData]
        );

        const extras = useWalletExtras({
            wallet,
            balance,
            satsBalance,
            tokenBalances,
            transfers,
            bitcoin,
            getFundingAddress,
            refresh: refreshWallet,
        });

        useEffect(() => {
            if (!wallet) {
                stopPoll();
                setBalance(null);
                setSatsBalance(null);
                setTokenBalances(new Map());
                setTransfers([]);
                setFundingAddress(null);
                setBalanceReady(false);
                setTxReady(false);
                setIsBalanceLoading(false);
                setIsTxLoading(false);
                claimPromiseRef.current = null;
                fundingAddressPromiseRef.current = null;
                return;
            }

            let cancelled = false;
            const boot = async () => {
                const [, firstTxPage] = await Promise.all([getBalance(), getRecentTxs()]);
                if (cancelled || !firstTxPage?.transfers?.length || !firstTxPage.hasMore) {
                    return;
                }

                if (!cancelled) {
                    void getAllTxs(firstTxPage);
                }
            };

            void boot();

            return () => {
                cancelled = true;
                stopPoll();
            };
        }, [wallet, getAllTxs, getBalance, getRecentTxs, stopPoll]);

        useEffect(() => {
            if (!wallet || !localCache) {
                return;
            }

            const cachedTransfers = readCachedTransfers(localCache);
            if (!cachedTransfers.length) {
                return;
            }

            setTransfers((currentTransfers) => (sameTransfers(currentTransfers, cachedTransfers) ? currentTransfers : cachedTransfers));
            setTxReady(true);
        }, [wallet, localCache]);

        useEffect(() => {
            if (!wallet || !localCache || !txReady) {
                return;
            }

            writeCachedTransfers(localCache, transfers);
        }, [wallet, localCache, transfers, txReady]);

        useEffect(() => {
            if (!wallet) {
                stopPoll();
                return;
            }

            if (hasPendingTxs && isActive()) {
                startPoll();
                return;
            }

            stopPoll();
        }, [wallet, hasPendingTxs, isActive, startPoll, stopPoll]);

        useEffect(() => {
            if (!wallet || !appState?.addEventListener) {
                return;
            }

            const sub = appState.addEventListener('change', (nextState) => {
                if (nextState === 'active') {
                    if (hasPendingTxs) {
                        startPoll();
                    }
                    void refreshWallet();
                    return;
                }

                stopPoll();
            });

            return () => sub?.remove?.();
        }, [appState, hasPendingTxs, refreshWallet, startPoll, stopPoll, wallet]);

        useEffect(() => {
            if (!wallet) {
                return;
            }

            const intervalId = setInterval(() => {
                if (!isActive()) {
                    return;
                }

                void refreshClaims();
            }, ACTIVE_CLAIM_RATE);

            return () => {
                clearInterval(intervalId);
            };
        }, [isActive, wallet, refreshClaims]);

        useEffect(() => {
            let active = true;

            const getBitcoinData = async () => {
                try {
                    const snap = await getDoc(doc(db, 'bitcoin', 'current'));
                    const data = snap.data();
                    if (!active || !data) {
                        return;
                    }

                    setBitcoin((current) => ({
                        price: data.price ?? current?.price ?? null,
                        block: data.block ?? current?.block ?? null,
                    }));
                } catch (error) {
                    console.debug?.('Failed to get Bitcoin data', error?.message ?? error);
                }
            };

            void getBitcoinData();
            const intervalId = setInterval(() => {
                void getBitcoinData();
            }, UPDATE_BTC_DATA_RATE);

            return () => {
                active = false;
                clearInterval(intervalId);
            };
        }, [db]);

        const value = useMemo(
            () => ({
                wallet,
                network,
                balance,
                satsBalance,
                tokenBalances,
                transfers,
                bitcoin,
                fundingAddress,
                balanceReady,
                txReady,
                isBalanceLoading,
                isTxLoading,
                isWalletDataReady: !!wallet,
                isWalletDataLoaded: !!wallet && balanceReady && txReady,
                refresh: refreshWallet,
                claimDeposits,
                getFundingAddress,
                sendMoneyWithSpark,
                withdrawFunds,
                ...extras,
            }),
            [wallet, balance, satsBalance, tokenBalances, transfers, bitcoin, fundingAddress, balanceReady, txReady, isBalanceLoading, isTxLoading, refreshWallet, claimDeposits, getFundingAddress, sendMoneyWithSpark, withdrawFunds, extras]
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
