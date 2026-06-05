'use client';
import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { openLocalDataCache } from '@/lib/cache/localdata';
import { unpackSeedData } from '@veyl/shared/crypto/pack';
import { deriveSeed, deriveWalletMnemonic } from '@veyl/shared/crypto/seed';
import { yieldToUi } from '@veyl/shared/utils/async';
import { LOCAL_DATA_CACHE_LABEL } from '@veyl/shared/cache/localdata';
import { decryptSeed } from '@/lib/crypto/seed';
import { normalizePassword } from '@veyl/shared/password';
import { bootWallet, lockWallet, bootChat, lockChat } from '@/lib/vault';
import { useUser } from '@/components/providers/userprovider';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import { cloud } from '@/lib/cloud';

export const VaultCtx = createContext(null);

const UNLOCK_STATES = new Set(['decrypting', 'seed-decrypted', 'deriving', 'wallet', 'chat', 'launching']);

export function VaultProvider({ children }) {
    const user = useUser();
    const [vault, setVault] = useState(null);
    const [wallet, setWallet] = useState(null);
    const [chatPrivateKey, setChatPrivateKey] = useState(null);
    const [localCache, setLocalCache] = useState(null);
    const [lockState, setLockState] = useState('locked');
    const { timer: autolockTimer, onHide: autolockOnHide, onBlur: autolockOnBlur } = user.settings?.autolock || {};
    const vaultUidRef = useRef(null);
    const walletRef = useRef(null);
    const chatPrivateKeyRef = useRef(null);
    const localCacheRef = useRef(null);
    const vaultRef = useRef(null);
    const vaultLoadErrorRef = useRef(null);
    const vaultWaitersRef = useRef(new Set());

    const updateVault = useCallback((nextVault) => {
        vaultRef.current = nextVault;
        vaultLoadErrorRef.current = null;
        setVault(nextVault);
        if (!nextVault) return;
        for (const waiter of vaultWaitersRef.current) {
            waiter.resolve(nextVault);
        }
        vaultWaitersRef.current.clear();
    }, []);

    const rejectVaultWaiters = useCallback((error) => {
        for (const waiter of vaultWaitersRef.current) {
            waiter.reject(error);
        }
        vaultWaitersRef.current.clear();
    }, []);

    const waitForVault = useCallback(() => {
        if (vaultRef.current) return Promise.resolve(vaultRef.current);
        if (vaultLoadErrorRef.current) return Promise.reject(vaultLoadErrorRef.current);
        return new Promise((resolve, reject) => {
            vaultWaitersRef.current.add({ resolve, reject });
        });
    }, []);

    useEffect(() => {
        walletRef.current = wallet;
    }, [wallet]);

    useEffect(() => {
        chatPrivateKeyRef.current = chatPrivateKey;
    }, [chatPrivateKey]);

    useEffect(() => {
        localCacheRef.current = localCache;
    }, [localCache]);

    // get account vault on mount
    useEffect(() => {
        const uid = user.uid || null;
        const previousUid = vaultUidRef.current;
        const uidChanged = previousUid !== uid;
        vaultUidRef.current = uid;

        if (uidChanged) {
            rejectVaultWaiters(new Error('account changed during vault load'));
            const liveWallet = walletRef.current;
            const liveChatPrivateKey = chatPrivateKeyRef.current;
            const liveLocalCache = localCacheRef.current;

            try {
                lockWallet(liveWallet);
                lockChat(liveChatPrivateKey);
                liveLocalCache?.close?.();
            } catch {}

            walletRef.current = null;
            chatPrivateKeyRef.current = null;
            localCacheRef.current = null;
            setWallet(null);
            setChatPrivateKey(null);
            setLocalCache(null);
            updateVault(null);
            setLockState('locked');

            if (previousUid) {
                cloud.user.active.write(previousUid, false).catch(() => {});
            }
        }

        if (!uid) return;
        let cancelled = false;
        (async () => {
            try {
                const nextVault = await cloud.user.vault.read(uid);
                if (!cancelled && vaultUidRef.current === uid) {
                    updateVault(nextVault);
                    if (!nextVault) {
                        const error = new Error('vault not available');
                        vaultLoadErrorRef.current = error;
                        rejectVaultWaiters(error);
                    }
                }
            } catch (error) {
                console.warn('failed to fetch account vault', error);
                if (!cancelled && vaultUidRef.current === uid) {
                    updateVault(null);
                    vaultLoadErrorRef.current = error;
                    rejectVaultWaiters(error);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [rejectVaultWaiters, updateVault, user.uid]);

    //boot features from master seed
    const unlock = useCallback(
        async (password, options = {}) => {
            //decrypt seed
            if (UNLOCK_STATES.has(lockState)) throw new Error('unlock in progress');
            const unlockUid = user.uid || cloud.auth.user?.uid || null;
            if (!unlockUid) throw new Error('account not ready');
            const isCurrentUnlock = () => vaultUidRef.current === unlockUid && cloud.auth.user?.uid === unlockUid;
            setLockState('decrypting');
            let w = null;
            let chatPrivKey = null;
            let masterSeed = null;
            let chatSeed = null;
            let cacheKey = null;
            let nextCache = null;
            try {
                const vault = await waitForVault();
                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }
                const { salt, iv, ct, kdf } = unpackSeedData(vault);
                masterSeed = await decryptSeed(ct, salt, iv, normalizePassword(password), kdf);
                setLockState('seed-decrypted');
                const seedDecrypted = options.onSeedDecrypted?.();

                // Derive feature-specific seeds
                setLockState('deriving');
                const walletMnemonic = deriveWalletMnemonic(masterSeed);
                chatSeed = deriveSeed(masterSeed, 'chat');
                cacheKey = deriveSeed(masterSeed, LOCAL_DATA_CACHE_LABEL);

                // Zero the master seed from memory
                masterSeed.fill(0);
                masterSeed = null;

                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }

                //boot wallet
                setLockState('wallet');
                w = await bootWallet(walletMnemonic, user);
                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }
                // boot chat
                setLockState('chat');
                chatPrivKey = await bootChat(chatSeed, user);
                chatSeed = null;
                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }
                nextCache = await openLocalDataCache(cacheKey, { uid: unlockUid });

                // Zero derived seeds from memory
                cacheKey.fill(0);
                cacheKey = null;

                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }

                walletRef.current = w;
                chatPrivateKeyRef.current = chatPrivKey;
                localCacheRef.current = nextCache;
                setWallet(w);
                setChatPrivateKey(chatPrivKey);
                setLocalCache(nextCache);
                await seedDecrypted;
                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }

                // Mark as unlocked
                setLockState('launching');
                await yieldToUi();
                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }
                setLockState('unlocked');

                // mark active (best-effort)
                cloud.user.active.write(unlockUid, true).catch(() => {});
            } catch (error) {
                try {
                    masterSeed?.fill?.(0);
                    chatSeed?.fill?.(0);
                    cacheKey?.fill?.(0);
                } catch {}
                try {
                    lockWallet(w);
                    lockChat(chatPrivKey);
                    nextCache?.close?.();
                } catch {}
                if (isCurrentUnlock()) {
                    walletRef.current = null;
                    chatPrivateKeyRef.current = null;
                    localCacheRef.current = null;
                    setWallet(null);
                    setChatPrivateKey(null);
                    setLocalCache(null);
                    setLockState('locked');
                }

                // mark inactive (best-effort)
                cloud.user.active.write(unlockUid, false).catch(() => {});
                throw error;
            }
        },
        [lockState, user, waitForVault]
    );

    //lock the app
    const lock = useCallback(
        (silent = false) => {
            if (lockState !== 'unlocked') return;
            setLockState('locking');
            try {
                lockWallet(wallet);
                lockChat(chatPrivateKey);
                localCache?.close?.();
            } finally {
                walletRef.current = null;
                chatPrivateKeyRef.current = null;
                localCacheRef.current = null;
                setWallet(null);
                setChatPrivateKey(null);
                setLocalCache(null);
                setLockState('locked');

                // mark inactive (best-effort)
                if (user.uid) {
                    cloud.user.active.write(user.uid, false).catch(() => {});
                }
                if (!silent) {
                    toast('Vault locked', {
                        icon: <Lock />,
                        description: 'Your chats and funds are safe.',
                    });
                }
            }
        },
        [wallet, chatPrivateKey, localCache, lockState]
    );

    // idle autolock
    const idleRef = useRef(null);
    const resetIdle = useCallback(() => {
        if (idleRef.current) clearTimeout(idleRef.current);
        if (autolockTimer === 'never') return;
        idleRef.current = setTimeout(() => lock(), 60000 * autolockTimer);
    }, [lock, autolockTimer]);

    // lock on idle timer
    useEffect(() => {
        if (autolockTimer === 'never') return;
        const ev = ['mousemove', 'keydown', 'mousedown', 'touchstart'];
        ev.forEach((e) => window.addEventListener(e, resetIdle));
        resetIdle();
        return () => {
            ev.forEach((e) => window.removeEventListener(e, resetIdle));
            if (idleRef.current) clearTimeout(idleRef.current);
        };
    }, [resetIdle, autolockTimer]);

    // lock on hide
    useEffect(() => {
        const visible = () => !document.hidden;
        const onVis = () => {
            if (!visible() && autolockOnHide) lock();
        };
        document.addEventListener('visibilitychange', onVis);
        return () => document.removeEventListener('visibilitychange', onVis);
    }, [lock, autolockOnHide]);

    // lock on blur
    useEffect(() => {
        if (!autolockOnBlur) return;
        const onBlur = () => lock();
        window.addEventListener('blur', onBlur);
        return () => window.removeEventListener('blur', onBlur);
    }, [lock, autolockOnBlur]);

    // lock on unload
    useEffect(() => {
        const onUnload = () => lock(true);
        window.addEventListener('beforeunload', onUnload);
        return () => window.removeEventListener('beforeunload', onUnload);
    }, [lock]);

    // lock on connection loss
    useEffect(() => {
        const onOffline = () => {
            lock();
        };
        window.addEventListener('offline', onOffline);
        return () => window.removeEventListener('offline', onOffline);
    }, [lock]);

    const value = useMemo(
        () => ({
            vault,
            wallet,
            chatPrivateKey,
            localCache,
            lockState,
            unlock,
            lock,
        }),
        [vault, wallet, chatPrivateKey, localCache, lockState, unlock, lock]
    );

    return <VaultCtx value={value}>{children}</VaultCtx>;
}

export const useVault = () => useContext(VaultCtx);
