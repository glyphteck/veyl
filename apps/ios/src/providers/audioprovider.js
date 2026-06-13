import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { cleanText } from '@veyl/shared/utils/text';

const AudioContext = createContext(null);
const StateContext = createContext(null);

let modeReady = false;

function empty() {
    return { kind: '', key: '' };
}

export function AudioProvider({ children }) {
    const audio = useAudioPlayer(null, { updateInterval: 100, keepAudioSessionActive: true });
    const status = useAudioPlayerStatus(audio);
    const activeRef = useRef({ kind: '', key: '', player: null });
    const pendingSeekRef = useRef(null);
    const positionsRef = useRef(new Map());
    const [src, setSrc] = useState({ key: '', uri: '', title: '' });
    const [active, setActive] = useState(empty());
    const [positionVersion, setPositionVersion] = useState(0);

    useEffect(() => {
        if (modeReady) {
            return;
        }
        modeReady = true;
        setAudioModeAsync({
            playsInSilentMode: true,
            interruptionMode: 'mixWithOthers',
            allowsRecording: false,
            shouldPlayInBackground: false,
            shouldRouteThroughEarpiece: false,
        }).catch((error) => {
            modeReady = false;
            console.warn('audio mode failed', error);
        });
    }, []);

    const set = useCallback((next) => {
        const cur = activeRef.current;
        if (cur.kind === next.kind && cur.key === next.key && cur.player === next.player) {
            return;
        }
        activeRef.current = next;
        setActive({ kind: next.kind, key: next.key });
    }, []);

    const clear = useCallback(
        ({ kind, key, player } = {}) => {
            const cur = activeRef.current;
            if (!cur.kind) return;
            if (kind && cur.kind !== kind) return;
            if (key && cur.key !== key) return;
            if (player && cur.player !== player) return;
            set({ kind: '', key: '', player: null });
        },
        [set]
    );

    const stop = useCallback(
        ({ except } = {}) => {
            const cur = activeRef.current;
            if (!cur.kind || cur.player === except) {
                return;
            }
            try {
                cur.player?.pause?.();
            } catch {}
            set({ kind: '', key: '', player: null });
        },
        [set]
    );

    const rememberPosition = useCallback((key, seconds, { publish = false } = {}) => {
        const nextKey = cleanText(key);
        const value = Number(seconds);
        if (!nextKey || !Number.isFinite(value)) {
            return 0;
        }
        const nextValue = Math.max(0, value);
        const previousValue = positionsRef.current.get(nextKey);
        positionsRef.current.set(nextKey, nextValue);
        if (publish && previousValue !== nextValue) {
            setPositionVersion((current) => current + 1);
        }
        return nextValue;
    }, []);

    const getPosition = useCallback((key) => {
        const nextKey = cleanText(key);
        if (!nextKey) {
            return 0;
        }
        const value = positionsRef.current.get(nextKey);
        return Number.isFinite(value) ? value : 0;
    }, []);

    const play = useCallback(
        ({ kind = 'audio', key, uri, title, player } = {}) => {
            const nextKind = cleanText(kind);
            const nextKey = cleanText(key);
            const nextUri = cleanText(uri);
            const nextPlayer = nextKind === 'audio' ? audio : player;
            if (!nextKind || !nextKey || !nextPlayer) {
                return;
            }

            try {
                stop({ except: nextPlayer });
                if (nextKind === 'audio') {
                    if (!nextUri) return;
                    const replacingSource = src.key !== nextKey || src.uri !== nextUri;
                    if (replacingSource) {
                        audio.replace({ uri: nextUri, name: title || 'audio' });
                        setSrc({ key: nextKey, uri: nextUri, title: title || 'audio' });
                    }
                    audio.loop = true;
                }
                set({ kind: nextKind, key: nextKey, player: nextPlayer });
                if (nextKind === 'audio') {
                    const startAt = getPosition(nextKey);
                    if (startAt > 0) {
                        if (src.key !== nextKey || src.uri !== nextUri) {
                            pendingSeekRef.current = { key: nextKey, seconds: startAt };
                            nextPlayer.play?.();
                        } else {
                            audio.seekTo(startAt, 0, 0).catch((error) => console.warn('audio resume seek failed', error)).finally(() => nextPlayer.play?.());
                        }
                    } else {
                        pendingSeekRef.current = null;
                        nextPlayer.play?.();
                    }
                    return;
                }
                nextPlayer.play?.();
            } catch (error) {
                console.warn(`${nextKind} play failed`, error);
            }
        },
        [audio, getPosition, set, src.key, src.uri, stop]
    );

    const pause = useCallback(({ kind, key, player } = {}) => {
        const cur = activeRef.current;
        const target = player || (!kind && !key ? cur.player : cur.kind === kind && cur.key === key ? cur.player : null);
        try {
            target?.pause?.();
        } catch (error) {
            console.warn('pause failed', error);
        }
    }, []);

    const seek = useCallback(
        (seconds, { key } = {}) => {
            const value = Number(seconds);
            if (!Number.isFinite(value)) {
                return;
            }
            const nextValue = Math.max(0, value);
            const nextKey = cleanText(key) || (activeRef.current.kind === 'audio' ? activeRef.current.key : '');
            if (nextKey) {
                rememberPosition(nextKey, nextValue, { publish: true });
            }
            if (activeRef.current.kind === 'audio' && (!nextKey || activeRef.current.key === nextKey)) {
                audio.seekTo(nextValue, 0, 0).catch((error) => {
                    console.warn('seek failed', error);
                });
            }
        },
        [audio, rememberPosition]
    );

    useEffect(() => {
        if (active.kind !== 'audio' || !active.key || src.key !== active.key) {
            return;
        }
        rememberPosition(active.key, status?.currentTime, { publish: false });
    }, [active.key, active.kind, rememberPosition, src.key, status?.currentTime]);

    useEffect(() => {
        const pending = pendingSeekRef.current;
        if (!pending || active.kind !== 'audio' || active.key !== pending.key || src.key !== pending.key) {
            return;
        }
        if (!Number.isFinite(status?.duration) || status.duration <= 0) {
            return;
        }
        pendingSeekRef.current = null;
        audio.seekTo(pending.seconds, 0, 0).catch((error) => {
            console.warn('audio pending seek failed', error);
        });
    }, [active.key, active.kind, audio, src.key, status?.duration]);

    const value = useMemo(
        () => ({
            kind: active.kind,
            key: active.key,
            getPosition,
            play,
            pause,
            stop,
            seek,
            clear,
        }),
        [active.kind, active.key, clear, getPosition, pause, play, positionVersion, seek, stop]
    );

    const state = useMemo(
        () => ({
            status,
            key: src.key,
            uri: src.uri,
        }),
        [src.key, src.uri, status]
    );

    return (
        <AudioContext.Provider value={value}>
            <StateContext.Provider value={state}>{children}</StateContext.Provider>
        </AudioContext.Provider>
    );
}

export function useAudio() {
    const ctx = useContext(AudioContext);
    if (!ctx) {
        throw new Error('useAudio must be used within an AudioProvider');
    }
    return ctx;
}

export function useAudioState() {
    const ctx = useContext(StateContext);
    if (!ctx) {
        throw new Error('useAudioState must be used within an AudioProvider');
    }
    return ctx;
}
