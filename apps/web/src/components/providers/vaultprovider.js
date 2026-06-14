'use client';
import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { openLocalDataCache } from '@/lib/cache/localdata';
import { getCacheSeed, getChatSeed, getDefaultWalletEntropy, isVaultIncompatibleError, mnemonicFromWalletEntropy, openSecretRegistry } from '@veyl/shared/crypto/seed';
import { deriveSettingsKey } from '@veyl/shared/settingscloud';
import { yieldToUi } from '@veyl/shared/utils/async';
import { decryptSeed, migrateVault, shouldMigrateVault, unpackVaultSeedData } from '@/lib/crypto/seed';
import { normalizePassword } from '@veyl/shared/password';
import { bootWallet, lockWallet, bootChat, lockChat } from '@/lib/vault';
import { useUser } from '@/components/providers/userprovider';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import { cloud } from '@/lib/cloud';
import { mark } from '@/lib/diagnostics';
import { resolveNetwork } from '@veyl/shared/network';

export const VaultCtx = createContext(null);

const UNLOCK_STATES = new Set(['decrypting', 'seed-decrypted', 'migrating', 'deriving', 'wallet', 'chat', 'launching']);
const WALLET_NETWORK = resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK });

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
            user.lockSettings?.();
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
    }, [rejectVaultWaiters, updateVault, user.lockSettings, user.uid]);

    //boot features from master seed
    const unlock = useCallback(
        async (password, options = {}) => {
            //decrypt seed
            const startedAt = Date.now();
            const source = options.source || 'password';
            if (UNLOCK_STATES.has(lockState)) {
                mark('vault.unlock.error', { elapsedMs: Date.now() - startedAt, source, reason: 'already-unlocking' });
                throw new Error('unlock in progress');
            }
            const unlockUid = user.uid || cloud.auth.user?.uid || null;
            if (!unlockUid) {
                mark('vault.unlock.error', { elapsedMs: Date.now() - startedAt, source, reason: 'missing-account' });
                throw new Error('account not ready');
            }
            const isCurrentUnlock = () => vaultUidRef.current === unlockUid && cloud.auth.user?.uid === unlockUid;
            mark('vault.unlock.start', {
                source,
                hasVault: !!vaultRef.current,
                hasWalletPK: !!user.walletPK,
                hasChatPK: !!user.chatPK,
            });
            setLockState('decrypting');
            let w = null;
            let chatPrivKey = null;
            let masterSeed = null;
            let walletEntropy = null;
            let chatSeed = null;
            let cacheKey = null;
            let settingsKey = null;
            let nextCache = null;
            try {
                const sessionStartedAt = Date.now();
                mark('vault.unlock.session.start', { source });
                if (!cloud.auth.user?.getIdToken) {
                    throw new Error('auth');
                }
                await cloud.auth.user.getIdToken(true);
                mark('vault.unlock.session.done', { elapsedMs: Date.now() - sessionStartedAt, source });
                let vault = await waitForVault();
                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }
                const unpackStartedAt = Date.now();
                let unpacked = null;
                try {
                    unpacked = unpackVaultSeedData(vault);
                } catch (error) {
                    if (!isVaultIncompatibleError(error) || !shouldMigrateVault(vault)) {
                        throw error;
                    }
                    setLockState('migrating');
                    const migrateStartedAt = Date.now();
                    mark('vault.unlock.migrate.start', { source });
                    const migration = await migrateVault(vault, password);
                    let verifyWallet = null;
                    let verifyChatPrivKey = null;
                    try {
                        verifyWallet = await bootWallet(mnemonicFromWalletEntropy(migration.walletEntropy), user);
                        verifyChatPrivKey = await bootChat(new Uint8Array(migration.chatSeed), user);
                        await cloud.user.vault.replace(unlockUid, {
                            vault: migration.vault,
                            expectedHash: migration.expectedHash,
                            from: migration.from,
                            to: migration.to,
                            walletPK: user.walletPK,
                            chatPK: user.chatPK,
                            network: WALLET_NETWORK,
                        });
                        vault = migration.vault;
                        updateVault(vault);
                        unpacked = unpackVaultSeedData(vault);
                        mark('vault.unlock.migrate.done', { elapsedMs: Date.now() - migrateStartedAt, source, from: migration.from, to: migration.to });
                    } finally {
                        migration.walletEntropy?.fill?.(0);
                        migration.chatSeed?.fill?.(0);
                        lockWallet(verifyWallet);
                        lockChat(verifyChatPrivKey);
                    }
                }
                const { salt, iv, ct, kdf, registry: registryEnvelope } = unpacked;
                mark('vault.unlock.unpack.done', { elapsedMs: Date.now() - unpackStartedAt, source });
                const decryptStartedAt = Date.now();
                mark('vault.unlock.decrypt.start', { source });
                masterSeed = await decryptSeed(ct, salt, iv, normalizePassword(password), kdf);
                mark('vault.unlock.decrypt.done', { elapsedMs: Date.now() - decryptStartedAt, source });
                setLockState('seed-decrypted');
                const animationStartedAt = Date.now();
                let animationMarked = false;
                const markAnimationDone = () => {
                    if (animationMarked) return;
                    animationMarked = true;
                    mark('vault.unlock.seedAnimation.done', { elapsedMs: Date.now() - animationStartedAt, source });
                };
                const markAnimationError = (error) => {
                    mark('vault.unlock.seedAnimation.error', { elapsedMs: Date.now() - animationStartedAt, source, code: error?.code || '', message: error?.message || String(error) });
                    markAnimationDone();
                };
                try {
                    const seedAnimation = options.onSeedDecrypted?.();
                    if (seedAnimation && typeof seedAnimation.then === 'function') {
                        seedAnimation.then(markAnimationDone, markAnimationError);
                    } else {
                        markAnimationDone();
                    }
                } catch (error) {
                    markAnimationError(error);
                }

                // Derive feature-specific seeds
                setLockState('deriving');
                const deriveStartedAt = Date.now();
                const secretRegistry = await openSecretRegistry(masterSeed, registryEnvelope);
                walletEntropy = getDefaultWalletEntropy(secretRegistry);
                const walletMnemonic = mnemonicFromWalletEntropy(walletEntropy);
                chatSeed = getChatSeed(secretRegistry);
                cacheKey = getCacheSeed(secretRegistry);
                settingsKey = deriveSettingsKey(cacheKey, unlockUid);
                mark('vault.unlock.derive.done', { elapsedMs: Date.now() - deriveStartedAt, source });

                // Zero the master seed from memory
                walletEntropy.fill(0);
                walletEntropy = null;
                masterSeed.fill(0);
                masterSeed = null;

                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }

                //boot wallet
                setLockState('wallet');
                const walletStartedAt = Date.now();
                mark('vault.unlock.wallet.start', { source });
                w = await bootWallet(walletMnemonic, user);
                mark('vault.unlock.wallet.done', { elapsedMs: Date.now() - walletStartedAt, source });
                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }
                // boot chat
                setLockState('chat');
                const chatStartedAt = Date.now();
                mark('vault.unlock.chat.start', { source });
                chatPrivKey = await bootChat(chatSeed, user);
                mark('vault.unlock.chat.done', { elapsedMs: Date.now() - chatStartedAt, source });
                chatSeed = null;
                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }
                const cacheStartedAt = Date.now();
                mark('vault.unlock.localCache.start', { source });
                nextCache = await openLocalDataCache(cacheKey, { uid: unlockUid });
                mark('vault.unlock.localCache.done', { elapsedMs: Date.now() - cacheStartedAt, source, hasCache: !!nextCache });

                const settingsStartedAt = Date.now();
                mark('vault.unlock.settings.start', { source });
                await user.unlockSettings(settingsKey);
                mark('vault.unlock.settings.done', { elapsedMs: Date.now() - settingsStartedAt, source });

                // Zero derived seeds from memory
                cacheKey.fill(0);
                cacheKey = null;
                settingsKey.fill(0);
                settingsKey = null;

                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }

                walletRef.current = w;
                chatPrivateKeyRef.current = chatPrivKey;
                localCacheRef.current = nextCache;
                setWallet(w);
                setChatPrivateKey(chatPrivKey);
                setLocalCache(nextCache);
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
                mark('vault.unlock.done', { elapsedMs: Date.now() - startedAt, source });

                // mark active (best-effort)
                cloud.user.active.write(unlockUid, true).catch(() => {});
            } catch (error) {
                mark('vault.unlock.error', { elapsedMs: Date.now() - startedAt, source, code: error?.code || '', message: error?.message || String(error) });
                try {
                    masterSeed?.fill?.(0);
                    walletEntropy?.fill?.(0);
                    chatSeed?.fill?.(0);
                    cacheKey?.fill?.(0);
                    settingsKey?.fill?.(0);
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
                    user.lockSettings?.();
                    setLockState('locked');
                }

                // mark inactive (best-effort)
                cloud.user.active.write(unlockUid, false).catch(() => {});
                throw error;
            }
        },
        [lockState, updateVault, user, waitForVault]
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
                user.lockSettings?.();
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
        [wallet, chatPrivateKey, localCache, lockState, user.lockSettings, user.uid]
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
