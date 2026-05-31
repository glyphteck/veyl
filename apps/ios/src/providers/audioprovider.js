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
    const [src, setSrc] = useState({ key: '', uri: '', title: '' });
    const [active, setActive] = useState(empty());

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
                    if (src.key !== nextKey || src.uri !== nextUri) {
                        audio.replace({ uri: nextUri, name: title || 'audio' });
                        setSrc({ key: nextKey, uri: nextUri, title: title || 'audio' });
                    }
                    audio.loop = true;
                }
                set({ kind: nextKind, key: nextKey, player: nextPlayer });
                nextPlayer.play?.();
            } catch (error) {
                console.warn(`${nextKind} play failed`, error);
            }
        },
        [audio, set, src.key, src.uri, stop]
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
        (seconds) => {
            const value = Number(seconds);
            if (!Number.isFinite(value)) {
                return;
            }
            audio.seekTo(Math.max(0, value)).catch((error) => {
                console.warn('seek failed', error);
            });
        },
        [audio]
    );

    const value = useMemo(
        () => ({
            kind: active.kind,
            key: active.key,
            play,
            pause,
            stop,
            seek,
            clear,
        }),
        [active.kind, active.key, clear, pause, play, seek, stop]
    );

    const state = useMemo(
        () => ({
            status,
            uri: src.uri,
        }),
        [src.uri, status]
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
