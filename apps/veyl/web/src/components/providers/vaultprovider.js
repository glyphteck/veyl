'use client';
import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase/firebaseclient';
import { openLocalDataCache } from '@/lib/localdatacache';
import { unpackSeedData } from '@glyphteck/shared/crypto/pack';
import { deriveSeed, deriveWalletMnemonic } from '@glyphteck/shared/crypto/seed';
import { LOCAL_DATA_CACHE_LABEL } from '@glyphteck/shared/localdatacache';
import { decryptSeed } from '@/lib/crypto/seed';
import { normalizePassword } from '@glyphteck/shared/password';
import { writePresence } from '@glyphteck/shared/presence';
import { bootWallet, lockWallet, bootChat, lockChat } from '@/lib/vaultutils';
import { useUser } from '@/components/providers/userprovider';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';

export const VaultCtx = createContext(null);

const UNLOCK_STATES = new Set(['decrypting', 'deriving', 'wallet', 'chat', 'launching']);

function nextTick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

export function VaultProvider({ children }) {
    const user = useUser();
    const [encSeed, setEncSeed] = useState(null);
    const [wallet, setWallet] = useState(null);
    const [chatPrivateKey, setChatPrivateKey] = useState(null);
    const [localCache, setLocalCache] = useState(null);
    const [lockState, setLockState] = useState('locked');
    const { timer: autolockTimer, onHide: autolockOnHide, onBlur: autolockOnBlur } = user.settings?.autolock || {};

    //get encrypted seed on mount
    useEffect(() => {
        if (!user.uid) return;
        (async () => {
            const snap = await getDoc(doc(db, 'seeds', user.uid));
            setEncSeed(snap.data()?.es ?? null);
        })();
    }, [user.uid]);

    //boot features from master seed
    const unlock = useCallback(
        async (password) => {
            //decrypt seed
            if (!encSeed) throw new Error('seed not ready');
            if (UNLOCK_STATES.has(lockState)) throw new Error('unlock in progress');
            setLockState('decrypting');
            let w = null;
            let chatPrivKey = null;
            let cacheKey = null;
            let nextCache = null;
            try {
                const { salt, iv, ct, kdf } = unpackSeedData(encSeed);
                const masterSeed = await decryptSeed(ct, salt, iv, normalizePassword(password), kdf);

                // Derive feature-specific seeds
                setLockState('deriving');
                const walletMnemonic = deriveWalletMnemonic(masterSeed);
                const chatSeed = deriveSeed(masterSeed, 'chat');
                cacheKey = deriveSeed(masterSeed, LOCAL_DATA_CACHE_LABEL);

                // Zero the master seed from memory
                masterSeed.fill(0);

                //boot wallet
                setLockState('wallet');
                w = await bootWallet(walletMnemonic, user);
                setWallet(w);
                // boot chat
                setLockState('chat');
                chatPrivKey = await bootChat(chatSeed, user);
                setChatPrivateKey(chatPrivKey);
                nextCache = await openLocalDataCache(cacheKey, { uid: user.uid });
                setLocalCache(nextCache);

                // Zero derived seeds from memory
                chatSeed.fill(0);
                cacheKey.fill(0);
                cacheKey = null;

                // Mark as unlocked
                setLockState('launching');
                await nextTick();
                setLockState('unlocked');

                // mark active (best-effort)
                if (user.uid) {
                    writePresence(db, user.uid, true).catch(() => {});
                }
            } catch (error) {
                try {
                    cacheKey?.fill?.(0);
                } catch {}
                try {
                    lockWallet(w);
                    lockChat(chatPrivKey);
                    nextCache?.close?.();
                } catch {}
                setWallet(null);
                setChatPrivateKey(null);
                setLocalCache(null);
                setLockState('locked');

                // mark inactive (best-effort)
                if (user.uid) {
                    writePresence(db, user.uid, false).catch(() => {});
                }
                throw error;
            }
        },
        [encSeed, lockState, user]
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
                setWallet(null);
                setChatPrivateKey(null);
                setLocalCache(null);
                setLockState('locked');

                // mark inactive (best-effort)
                if (user.uid) {
                    writePresence(db, user.uid, false).catch(() => {});
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
            encSeed,
            wallet,
            chatPrivateKey,
            localCache,
            lockState,
            unlock,
            lock,
        }),
        [encSeed, wallet, chatPrivateKey, localCache, lockState, unlock, lock]
    );

    return <VaultCtx value={value}>{children}</VaultCtx>;
}

export const useVault = () => useContext(VaultCtx);
