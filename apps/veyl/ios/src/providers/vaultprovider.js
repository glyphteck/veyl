import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';

import { auth, db } from '@/lib/firebase';
import { stageFaceIdPassword, shouldStageFaceIdPassword } from '@/lib/faceid';
import { openLocalDataCache } from '@/lib/localdatacache';
import { clearMsgImageCache } from '@/lib/msgimagecache';
import { useUser } from '@/providers/userprovider';
import { unpackSeedData } from '@glyphteck/shared/crypto/pack';
import { deriveSeed, deriveWalletMnemonic } from '@glyphteck/shared/crypto/seed';
import { LOCAL_DATA_CACHE_LABEL } from '@glyphteck/shared/localdatacache';
import { decryptSeed } from '@/lib/crypto/seed';
import { normalizePassword } from '@glyphteck/shared/password';
import { writePresence } from '@glyphteck/shared/presence';
import { bootWallet, bootChat, lockWallet, lockChat } from '@/lib/vaultutils';
import { mark } from '@/lib/diagnostics';

const VaultContext = createContext(null);
function zero(bytes) {
    try {
        bytes?.fill?.(0);
    } catch {}
}

export function VaultProvider({ children }) {
    const user = useUser();
    const [encSeed, setEncSeed] = useState(null);
    const [seedReady, setSeedReady] = useState(false);
    const [wallet, setWallet] = useState(null);
    const [chatPrivateKey, setChatPrivateKey] = useState(null);
    const [localCache, setLocalCache] = useState(null);
    const [lockState, setLockState] = useState('locked');
    const [faceIdFailed, setFaceIdFailed] = useState(false);

    const presenceRef = useRef({ uid: null, active: false });
    const seedUidRef = useRef(null);
    const walletRef = useRef(null);
    const chatPrivateKeyRef = useRef(null);
    const localCacheRef = useRef(null);
    const idleRef = useRef(null);

    const { timer: autolockTimer, onBackground: autolockOnBackground } = user.settings?.autolock || {};

    useEffect(() => {
        mark('vault.lockState', {
            lockState,
            hasWallet: !!wallet,
            hasChatPrivateKey: !!chatPrivateKey,
            hasLocalCache: !!localCache,
        });
    }, [chatPrivateKey, localCache, lockState, wallet]);

    const clearIdle = useCallback(() => {
        if (!idleRef.current) return;
        clearTimeout(idleRef.current);
        idleRef.current = null;
    }, []);

    const syncPresence = useCallback(async (uid, active) => {
        if (!uid) return;
        try {
            await writePresence(db, uid, !!active);
        } catch {
            // best-effort
        }
    }, []);

    const closeLocalCache = useCallback(({ resetState = true } = {}) => {
        const current = localCacheRef.current;
        localCacheRef.current = null;
        try {
            current?.close?.();
        } catch {}
        if (resetState) {
            setLocalCache(null);
        }
    }, []);

    const setPresenceActive = useCallback(
        (nextActive) => {
            const uid = user.uid || auth.currentUser?.uid;

            if (!uid) {
                if (presenceRef.current.uid) {
                    void syncPresence(presenceRef.current.uid, false);
                }
                presenceRef.current = { uid: null, active: false };
                return;
            }

            if (presenceRef.current.uid && presenceRef.current.uid !== uid) {
                void syncPresence(presenceRef.current.uid, false);
                presenceRef.current = { uid, active: false };
            }

            if (presenceRef.current.uid === uid && presenceRef.current.active === !!nextActive) return;
            presenceRef.current = { uid, active: !!nextActive };
            void syncPresence(uid, !!nextActive);
        },
        [syncPresence, user.uid]
    );

    const wipeLiveSecrets = useCallback(
        ({ resetState = true, resetFaceIdFailed = false } = {}) => {
            const liveWallet = walletRef.current;
            const liveChatPrivateKey = chatPrivateKeyRef.current;

            walletRef.current = null;
            chatPrivateKeyRef.current = null;
            closeLocalCache({ resetState });

            try {
                lockWallet(liveWallet);
            } catch {}

            try {
                lockChat(liveChatPrivateKey);
            } catch {}

            if (!resetState) return;

            setWallet(null);
            setChatPrivateKey(null);
            void clearMsgImageCache().catch(() => {});
            if (resetFaceIdFailed) {
                setFaceIdFailed(false);
            }
        },
        [closeLocalCache]
    );

    const lock = useCallback(() => {
        if (lockState === 'locked') return;

        const startedAt = Date.now();
        mark('vault.lock.start', { lockState });
        clearIdle();
        setPresenceActive(false);
        wipeLiveSecrets({ resetState: true, resetFaceIdFailed: true });
        setLockState('locked');
        mark('vault.lock.done', { elapsedMs: Date.now() - startedAt });
    }, [clearIdle, lockState, setPresenceActive, wipeLiveSecrets]);

    const resetIdle = useCallback(() => {
        clearIdle();
        if (lockState !== 'unlocked' || autolockTimer === 'never' || AppState.currentState !== 'active') {
            return;
        }

        idleRef.current = setTimeout(() => {
            idleRef.current = null;
            lock();
        }, 60000 * autolockTimer);
    }, [autolockTimer, clearIdle, lock, lockState]);

    const touch = useCallback(() => {
        if (lockState !== 'unlocked' || AppState.currentState !== 'active') {
            return;
        }
        resetIdle();
    }, [lockState, resetIdle]);

    useEffect(() => {
        const uid = user.uid || auth.currentUser?.uid;
        if (seedUidRef.current !== uid) {
            seedUidRef.current = uid || null;
            setPresenceActive(false);
            wipeLiveSecrets({ resetState: true, resetFaceIdFailed: true });
            setEncSeed(null);
            setSeedReady(false);
            setLockState('locked');
        }

        if (!uid) {
            setPresenceActive(false);
            wipeLiveSecrets({ resetState: true, resetFaceIdFailed: true });
            setEncSeed(null);
            setSeedReady(false);
            setLockState('locked');
            return;
        }

        const listenStartedAt = Date.now();
        mark('vault.seed.listen.start', {});
        const unsub = onSnapshot(
            doc(db, 'seeds', uid),
            (snap) => {
                const nextSeed = snap.data()?.es ?? null;
                mark('vault.seed.snapshot', { elapsedMs: Date.now() - listenStartedAt, exists: snap.exists(), hasSeed: !!nextSeed });
                setEncSeed(nextSeed);
                setSeedReady(true);
            },
            (err) => {
                mark('vault.seed.snapshot.error', { elapsedMs: Date.now() - listenStartedAt, code: err?.code || '', message: err?.message || String(err) });
                console.warn('failed to fetch encrypted seed', err);
                setPresenceActive(false);
                wipeLiveSecrets({ resetState: true, resetFaceIdFailed: true });
                setEncSeed(null);
                setSeedReady(true);
                setLockState('locked');
            }
        );

        return () => {
            mark('vault.seed.listen.stop', { elapsedMs: Date.now() - listenStartedAt });
            unsub();
            setSeedReady(false);
        };
    }, [user.uid, setPresenceActive, wipeLiveSecrets]);

    useEffect(() => {
        const sub = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') {
                const shouldBeActive = lockState === 'unlocked';
                setPresenceActive(shouldBeActive);
                if (shouldBeActive) {
                    resetIdle();
                }
                return;
            }

            clearIdle();

            if (nextState === 'background' && autolockOnBackground) {
                lock();
                return;
            }

            setPresenceActive(false);
        });

        const initialShouldBeActive = AppState.currentState === 'active' && lockState === 'unlocked';
        setPresenceActive(initialShouldBeActive);
        if (initialShouldBeActive) {
            resetIdle();
        }

        return () => {
            sub?.remove?.();
            clearIdle();
        };
    }, [autolockOnBackground, clearIdle, lock, lockState, resetIdle, setPresenceActive]);

    useEffect(() => {
        if (lockState !== 'unlocked') {
            clearIdle();
            return;
        }

        resetIdle();
        return clearIdle;
    }, [autolockTimer, clearIdle, lockState, resetIdle]);

    useEffect(() => {
        return () => {
            clearIdle();
            setPresenceActive(false);
            wipeLiveSecrets({ resetState: false });
        };
    }, [clearIdle, setPresenceActive, wipeLiveSecrets]);

    const unlockWithPsw = useCallback(
        async (password, options = {}) => {
            const startedAt = Date.now();
            const source = options.source || (options.stageFaceId === false ? 'faceid' : 'password');
            if (!encSeed) {
                mark('vault.unlock.error', { elapsedMs: Date.now() - startedAt, source, reason: 'missing-seed' });
                throw new Error('seed not ready');
            }
            if (lockState === 'unlocking') {
                mark('vault.unlock.error', { elapsedMs: Date.now() - startedAt, source, reason: 'already-unlocking' });
                throw new Error('unlock in progress');
            }

            mark('vault.unlock.start', {
                source,
                hasSeed: !!encSeed,
                hasWalletPK: !!user.walletPK,
                hasChatPK: !!user.chatPK,
                hasFaceIDSetting: typeof user.settings?.faceID === 'boolean',
            });
            setLockState('unlocking');
            let w = null;
            let chatPrivKey = null;
            let masterSeed = null;
            let chatSeed = null;
            let cacheKey = null;
            let nextCache = null;
            const unlockUid = user.uid || auth.currentUser?.uid || null;
            if (!unlockUid) {
                mark('vault.unlock.error', { elapsedMs: Date.now() - startedAt, source, reason: 'missing-account' });
                throw new Error('account not ready');
            }
            const isCurrentUnlock = () => seedUidRef.current === unlockUid && auth.currentUser?.uid === unlockUid;

            try {
                const unpackStartedAt = Date.now();
                const { salt, iv, ct, kdf } = unpackSeedData(encSeed);
                mark('vault.unlock.unpack.done', { elapsedMs: Date.now() - unpackStartedAt, source });
                const decryptStartedAt = Date.now();
                mark('vault.unlock.decrypt.start', { source });
                masterSeed = await decryptSeed(ct, salt, iv, normalizePassword(password), kdf);
                mark('vault.unlock.decrypt.done', { elapsedMs: Date.now() - decryptStartedAt, source });

                setLockState('seed-decrypted');
                const animationStartedAt = Date.now();
                await options.onSeedDecrypted?.();
                mark('vault.unlock.seedAnimation.done', { elapsedMs: Date.now() - animationStartedAt, source });

                const faceIdStartedAt = Date.now();
                const shouldStagePassword = options.stageFaceId !== false && (await shouldStageFaceIdPassword(unlockUid, user.settings?.faceID));
                mark('vault.unlock.faceIdStageCheck.done', { elapsedMs: Date.now() - faceIdStartedAt, source, shouldStagePassword });

                const deriveStartedAt = Date.now();
                const walletMnemonic = deriveWalletMnemonic(masterSeed);
                chatSeed = deriveSeed(masterSeed, 'chat');
                cacheKey = deriveSeed(masterSeed, LOCAL_DATA_CACHE_LABEL);
                mark('vault.unlock.derive.done', { elapsedMs: Date.now() - deriveStartedAt, source });

                masterSeed.fill(0);
                masterSeed = null;

                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }

                const walletStartedAt = Date.now();
                mark('vault.unlock.wallet.start', { source });
                w = await bootWallet(walletMnemonic, user);
                mark('vault.unlock.wallet.done', { elapsedMs: Date.now() - walletStartedAt, source });
                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }
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

                zero(cacheKey);
                cacheKey = null;

                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }

                if (shouldStagePassword) {
                    const stageStartedAt = Date.now();
                    mark('vault.unlock.faceIdStage.start', { source });
                    await stageFaceIdPassword(normalizePassword(password), unlockUid);
                    mark('vault.unlock.faceIdStage.done', { elapsedMs: Date.now() - stageStartedAt, source });
                }

                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }

                walletRef.current = w;
                chatPrivateKeyRef.current = chatPrivKey;
                localCacheRef.current = nextCache;
                setWallet(w);
                setChatPrivateKey(chatPrivKey);
                setLocalCache(nextCache);
                setLockState('unlocked');
                setPresenceActive(true);
                mark('vault.unlock.done', { elapsedMs: Date.now() - startedAt, source });
            } catch (err) {
                mark('vault.unlock.error', { elapsedMs: Date.now() - startedAt, source, code: err?.code || '', message: err?.message || String(err) });
                zero(masterSeed);
                zero(chatSeed);
                zero(cacheKey);
                try {
                    lockWallet(w);
                    lockChat(chatPrivKey);
                    nextCache?.close?.();
                } catch {}
                if (isCurrentUnlock()) {
                    setPresenceActive(false);
                    walletRef.current = null;
                    chatPrivateKeyRef.current = null;
                    localCacheRef.current = null;
                    setWallet(null);
                    setChatPrivateKey(null);
                    setLocalCache(null);
                    setLockState('locked');
                } else {
                    void syncPresence(unlockUid, false);
                }
                throw err;
            }
        },
        [encSeed, lockState, user, setPresenceActive, syncPresence]
    );

    const value = useMemo(
        () => ({
            encSeed,
            seedReady,
            wallet,
            chatPrivateKey,
            localCache,
            lockState,
            faceIdFailed,
            setFaceIdFailed,
            unlockWithPsw,
            lock,
            touch,
        }),
        [chatPrivateKey, encSeed, faceIdFailed, localCache, lock, lockState, seedReady, touch, unlockWithPsw, wallet]
    );

    return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault() {
    const ctx = useContext(VaultContext);
    if (!ctx) throw new Error('useVault must be used within a VaultProvider');
    return ctx;
}
