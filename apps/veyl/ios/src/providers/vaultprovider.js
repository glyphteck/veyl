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
    const walletRef = useRef(null);
    const chatPrivateKeyRef = useRef(null);
    const localCacheRef = useRef(null);
    const idleRef = useRef(null);

    const { timer: autolockTimer, onBackground: autolockOnBackground } = user.settings?.autolock || {};

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

        clearIdle();
        setPresenceActive(false);
        wipeLiveSecrets({ resetState: true, resetFaceIdFailed: true });
        setLockState('locked');
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
        if (!uid) {
            setPresenceActive(false);
            wipeLiveSecrets({ resetState: true, resetFaceIdFailed: true });
            setEncSeed(null);
            setSeedReady(false);
            setLockState('locked');
            return;
        }

        const unsub = onSnapshot(
            doc(db, 'seeds', uid),
            (snap) => {
                setEncSeed(snap.data()?.es ?? null);
                setSeedReady(true);
            },
            (err) => {
                console.warn('failed to fetch encrypted seed', err);
                setPresenceActive(false);
                wipeLiveSecrets({ resetState: true, resetFaceIdFailed: true });
                setEncSeed(null);
                setSeedReady(true);
                setLockState('locked');
            }
        );

        return () => {
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
            if (!encSeed) throw new Error('seed not ready');
            if (lockState === 'unlocking') throw new Error('unlock in progress');

            setLockState('unlocking');
            let w = null;
            let chatPrivKey = null;
            let cacheKey = null;
            let nextCache = null;

            try {
                const uid = user.uid || auth.currentUser?.uid;
                const { salt, iv, ct, kdf } = unpackSeedData(encSeed);
                const masterSeed = await decryptSeed(ct, salt, iv, normalizePassword(password), kdf);

                setLockState('seed-decrypted');
                await options.onSeedDecrypted?.();

                const shouldStagePassword = options.stageFaceId !== false && uid && (await shouldStageFaceIdPassword(uid, user.settings?.faceID));

                const walletMnemonic = deriveWalletMnemonic(masterSeed);
                const chatSeed = deriveSeed(masterSeed, 'chat');
                cacheKey = deriveSeed(masterSeed, LOCAL_DATA_CACHE_LABEL);

                masterSeed.fill(0);

                w = await bootWallet(walletMnemonic, user);
                chatPrivKey = await bootChat(chatSeed, user);
                nextCache = await openLocalDataCache(cacheKey, { uid });

                walletRef.current = w;
                chatPrivateKeyRef.current = chatPrivKey;
                localCacheRef.current = nextCache;
                setWallet(w);
                setChatPrivateKey(chatPrivKey);
                setLocalCache(nextCache);

                zero(chatSeed);
                zero(cacheKey);
                cacheKey = null;

                if (shouldStagePassword) {
                    await stageFaceIdPassword(normalizePassword(password), uid);
                }

                setLockState('unlocked');
                setPresenceActive(true);
            } catch (err) {
                zero(cacheKey);
                setPresenceActive(false);
                try {
                    lockWallet(w);
                    lockChat(chatPrivKey);
                    nextCache?.close?.();
                } catch {}
                walletRef.current = null;
                chatPrivateKeyRef.current = null;
                localCacheRef.current = null;
                setWallet(null);
                setChatPrivateKey(null);
                setLocalCache(null);
                setLockState('locked');
                throw err;
            }
        },
        [encSeed, lockState, user, setPresenceActive]
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
