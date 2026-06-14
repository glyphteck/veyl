import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { cloud } from '@/lib/cloud';
import { clearFaceIdPassword, getFaceIdChoice, isFaceIdPasswordStaged, setFaceIdChoice, stageFaceIdPassword, shouldStageFaceIdPassword } from '@/lib/faceid';
import { openLocalDataCache } from '@/lib/cache/localdata';
import { clearMsgImageCache } from '@/lib/chat/imagecache';
import { useUser } from '@/providers/userprovider';
import { getCacheSeed, getChatSeed, getDefaultWalletEntropy, isVaultIncompatibleError, mnemonicFromWalletEntropy, openSecretRegistry } from '@veyl/shared/crypto/seed';
import { deriveSettingsKey } from '@veyl/shared/settingscloud';
import { decryptSeed, migrateVault, shouldMigrateVault, unpackVaultSeedData } from '@/lib/crypto/seed';
import { normalizePassword } from '@veyl/shared/password';
import { resolveNetwork } from '@veyl/shared/network';
import { bootWallet, bootChat, lockWallet, lockChat } from '@/lib/vault';
import { mark } from '@/lib/diagnostics';

const VaultContext = createContext(null);
const WALLET_NETWORK = resolveNetwork(globalThis?.process?.env ?? {});
function zero(bytes) {
    try {
        bytes?.fill?.(0);
    } catch {}
}

export function VaultProvider({ children }) {
    const user = useUser();
    const [vault, setVault] = useState(null);
    const [vaultReady, setVaultReady] = useState(false);
    const [wallet, setWallet] = useState(null);
    const [chatPrivateKey, setChatPrivateKey] = useState(null);
    const [localCache, setLocalCache] = useState(null);
    const [lockState, setLockState] = useState('locked');
    const [faceIdFailed, setFaceIdFailed] = useState(false);
    const [faceIdChoice, setFaceIdChoiceState] = useState(null);
    const [faceIdStaged, setFaceIdStaged] = useState(false);
    const [faceIdChoiceReady, setFaceIdChoiceReady] = useState(false);

    const presenceRef = useRef({ uid: null, active: false });
    const vaultUidRef = useRef(null);
    const walletRef = useRef(null);
    const chatPrivateKeyRef = useRef(null);
    const localCacheRef = useRef(null);
    const idleRef = useRef(null);

    const { timer: autolockTimer, onBackground: autolockOnBackground } = user.settings?.autolock || {};
    const faceIdConfigured = faceIdChoiceReady && typeof faceIdChoice === 'boolean';
    const faceIdEnabled = faceIdConfigured && faceIdChoice === true && faceIdStaged;

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
            await cloud.user.active.write(uid, !!active);
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
            const uid = user.uid || cloud.auth.user?.uid;

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

    useEffect(() => {
        const uid = user.uid || cloud.auth.user?.uid || null;
        let cancelled = false;
        setFaceIdChoiceReady(false);
        setFaceIdChoiceState(null);
        setFaceIdStaged(false);

        if (!uid) {
            setFaceIdChoiceReady(true);
            return undefined;
        }

        void Promise.all([getFaceIdChoice(uid), isFaceIdPasswordStaged(uid)])
            .then(([choice, staged]) => {
                if (!cancelled) {
                    setFaceIdChoiceState(choice);
                    setFaceIdStaged(choice === true && staged);
                    setFaceIdChoiceReady(true);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setFaceIdChoiceState(null);
                    setFaceIdStaged(false);
                    setFaceIdChoiceReady(true);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [user.uid]);

    const setFaceIdEnabled = useCallback(async (enabled) => {
        const uid = user.uid || cloud.auth.user?.uid || null;
        if (!uid) throw new Error('auth');
        const next = enabled === true ? true : enabled === false ? false : null;
        await setFaceIdChoice(uid, next);
        if (next !== true) {
            await clearFaceIdPassword(uid).catch(() => false);
        }
        setFaceIdChoiceState(next);
        setFaceIdStaged(next === true ? await isFaceIdPasswordStaged(uid) : false);
        setFaceIdChoiceReady(true);
        return next;
    }, [user.uid]);

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
            user.lockSettings?.();
            void clearMsgImageCache().catch(() => {});
            if (resetFaceIdFailed) {
                setFaceIdFailed(false);
            }
        },
        [closeLocalCache, user.lockSettings]
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
        const uid = user.uid || cloud.auth.user?.uid;
        if (vaultUidRef.current !== uid) {
            vaultUidRef.current = uid || null;
            setPresenceActive(false);
            wipeLiveSecrets({ resetState: true, resetFaceIdFailed: true });
            setVault(null);
            setVaultReady(false);
            setLockState('locked');
        }

        if (!uid) {
            setPresenceActive(false);
            wipeLiveSecrets({ resetState: true, resetFaceIdFailed: true });
            setVault(null);
            setVaultReady(false);
            setLockState('locked');
            return;
        }

        const listenStartedAt = Date.now();
        mark('vault.cloud.listen.start', {});
        const unsub = cloud.user.vault.watch(
            uid,
            (nextVault, info = {}) => {
                mark('vault.cloud.snapshot', { elapsedMs: Date.now() - listenStartedAt, exists: !!info.exists, hasVault: !!nextVault });
                setVault(nextVault);
                setVaultReady(true);
            },
            (err) => {
                mark('vault.cloud.snapshot.error', { elapsedMs: Date.now() - listenStartedAt, code: err?.code || '', message: err?.message || String(err) });
                console.warn('failed to fetch account vault', err);
                setPresenceActive(false);
                wipeLiveSecrets({ resetState: true, resetFaceIdFailed: true });
                setVault(null);
                setVaultReady(true);
                setLockState('locked');
            }
        );

        return () => {
            mark('vault.cloud.listen.stop', { elapsedMs: Date.now() - listenStartedAt });
            unsub();
            setVaultReady(false);
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
            if (!vault) {
                mark('vault.unlock.error', { elapsedMs: Date.now() - startedAt, source, reason: 'missing-vault' });
                throw new Error('vault not ready');
            }
            if (lockState !== 'locked') {
                mark('vault.unlock.error', { elapsedMs: Date.now() - startedAt, source, reason: 'already-unlocking' });
                throw new Error('unlock in progress');
            }

            mark('vault.unlock.start', {
                source,
                hasVault: !!vault,
                hasWalletPK: !!user.walletPK,
                hasChatPK: !!user.chatPK,
                hasFaceIDSetting: faceIdConfigured,
            });
            setLockState('unlocking');
            let w = null;
            let chatPrivKey = null;
            let masterSeed = null;
            let walletEntropy = null;
            let chatSeed = null;
            let cacheKey = null;
            let settingsKey = null;
            let nextCache = null;
            const unlockUid = user.uid || cloud.auth.user?.uid || null;
            if (!unlockUid) {
                mark('vault.unlock.error', { elapsedMs: Date.now() - startedAt, source, reason: 'missing-account' });
                throw new Error('account not ready');
            }
            const isCurrentUnlock = () => vaultUidRef.current === unlockUid && cloud.auth.user?.uid === unlockUid;

            try {
                const sessionStartedAt = Date.now();
                mark('vault.unlock.session.start', { source });
                if (!cloud.auth.user?.getIdToken) {
                    throw new Error('auth');
                }
                await cloud.auth.user.getIdToken(true);
                mark('vault.unlock.session.done', { elapsedMs: Date.now() - sessionStartedAt, source });
                const unpackStartedAt = Date.now();
                let nextVault = vault;
                let unpacked = null;
                try {
                    unpacked = unpackVaultSeedData(nextVault);
                } catch (error) {
                    if (!isVaultIncompatibleError(error) || !shouldMigrateVault(nextVault)) {
                        throw error;
                    }
                    setLockState('migrating');
                    const migrateStartedAt = Date.now();
                    mark('vault.unlock.migrate.start', { source });
                    const migration = await migrateVault(nextVault, password);
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
                        nextVault = migration.vault;
                        setVault(nextVault);
                        unpacked = unpackVaultSeedData(nextVault);
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

                const deriveStartedAt = Date.now();
                const secretRegistry = await openSecretRegistry(masterSeed, registryEnvelope);
                walletEntropy = getDefaultWalletEntropy(secretRegistry);
                const walletMnemonic = mnemonicFromWalletEntropy(walletEntropy);
                chatSeed = getChatSeed(secretRegistry);
                cacheKey = getCacheSeed(secretRegistry);
                settingsKey = deriveSettingsKey(cacheKey, unlockUid);
                mark('vault.unlock.derive.done', { elapsedMs: Date.now() - deriveStartedAt, source });

                zero(walletEntropy);
                walletEntropy = null;
                masterSeed.fill(0);
                masterSeed = null;

                if (!isCurrentUnlock()) {
                    throw new Error('account changed during unlock');
                }

                const settingsStartedAt = Date.now();
                mark('vault.unlock.settings.start', { source });
                const syncedSettings = await user.unlockSettings(settingsKey);
                if (syncedSettings?.faceID === true) {
                    await setFaceIdChoice(unlockUid, true);
                    setFaceIdChoiceState(true);
                    setFaceIdStaged(await isFaceIdPasswordStaged(unlockUid));
                    setFaceIdChoiceReady(true);
                } else if (syncedSettings?.faceID === false) {
                    await setFaceIdChoice(unlockUid, false);
                    await clearFaceIdPassword(unlockUid).catch(() => false);
                    setFaceIdChoiceState(false);
                    setFaceIdStaged(false);
                    setFaceIdChoiceReady(true);
                } else {
                    await setFaceIdChoice(unlockUid, null);
                    await clearFaceIdPassword(unlockUid).catch(() => false);
                    setFaceIdChoiceState(null);
                    setFaceIdStaged(false);
                    setFaceIdChoiceReady(true);
                }
                mark('vault.unlock.settings.done', { elapsedMs: Date.now() - settingsStartedAt, source });
                zero(settingsKey);
                settingsKey = null;

                const faceIdStartedAt = Date.now();
                const shouldStagePassword = options.stageFaceId !== false && (await shouldStageFaceIdPassword(unlockUid, syncedSettings?.faceID));
                mark('vault.unlock.faceIdStageCheck.done', { elapsedMs: Date.now() - faceIdStartedAt, source, shouldStagePassword });

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
                    setFaceIdStaged(await isFaceIdPasswordStaged(unlockUid));
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
                zero(walletEntropy);
                zero(chatSeed);
                zero(cacheKey);
                zero(settingsKey);
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
                    user.lockSettings?.();
                    setLockState('locked');
                } else {
                    void syncPresence(unlockUid, false);
                }
                throw err;
            }
        },
        [faceIdConfigured, vault, lockState, user, setPresenceActive, syncPresence]
    );

    const value = useMemo(
        () => ({
            vault,
            vaultReady,
            wallet,
            chatPrivateKey,
            localCache,
            lockState,
            faceIdFailed,
            faceIdChoiceReady,
            faceIdConfigured,
            faceIdEnabled,
            setFaceIdFailed,
            setFaceIdEnabled,
            unlockWithPsw,
            lock,
            touch,
        }),
        [chatPrivateKey, vault, faceIdChoiceReady, faceIdConfigured, faceIdEnabled, faceIdFailed, localCache, lock, lockState, setFaceIdEnabled, vaultReady, touch, unlockWithPsw, wallet]
    );

    return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault() {
    const ctx = useContext(VaultContext);
    if (!ctx) throw new Error('useVault must be used within a VaultProvider');
    return ctx;
}
