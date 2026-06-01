import { useCallback, useRef } from 'react';

import { WALLET_AUTO_CLAIM_MAX_FEE_SATS, WALLET_CLAIM_PAGE_SIZE } from '../config.js';
import { markDiag, markDone } from '../utils/diagnostics.js';

const AUTO_CLAIM_MAX_FEE_SATS = WALLET_AUTO_CLAIM_MAX_FEE_SATS;
const CLAIM_PAGE_SIZE = WALLET_CLAIM_PAGE_SIZE;

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

export function useDepositClaims({ wallet, getFundingAddress, updateWalletData, diag }) {
    const claimPromiseRef = useRef(null);

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

    const refreshWallet = useCallback(async () => {
        const startedAt = Date.now();
        markDiag(diag, 'wallet.refresh.start', {});
        const claimed = await claimDeposits();
        await updateWalletData({ force: true, reason: 'deposit-refresh' });
        markDone(diag, 'wallet.refresh', startedAt, { claimed: !!claimed });
    }, [claimDeposits, diag, updateWalletData]);

    const refreshClaims = useCallback(async () => {
        const claimed = await claimDeposits();
        if (!claimed) {
            return false;
        }

        await updateWalletData({ force: true, reason: 'deposit-claim' });
        return true;
    }, [claimDeposits, updateWalletData]);

    const resetClaims = useCallback(() => {
        claimPromiseRef.current = null;
    }, []);

    return {
        claimDeposits,
        refreshWallet,
        refreshClaims,
        resetClaims,
    };
}
