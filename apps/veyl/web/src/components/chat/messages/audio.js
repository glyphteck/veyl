'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader, Pause, Play } from 'lucide-react';
import { useChat } from '@/components/providers/chatprovider';
import { bubbleBg } from '@/lib/messages';
import { clear, play } from '@/lib/media';
import { getAttachmentCaption, getAttachmentTitle, isExpiredAttachmentMsg } from '@glyphteck/shared/chat/messages';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { stopClick } from './utils';

const audioCache = new Map();
const MAX_AUDIO_CACHE = 16;

function fmtTime(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return '0:00';
    }

    const total = Math.floor(value);
    const mins = Math.floor(total / 60);
    const secs = String(total % 60).padStart(2, '0');
    return `${mins}:${secs}`;
}

function getCacheKey(peerChatPK, msg) {
    return `${peerChatPK}:${msg?.p || ''}:${msg?.k || ''}`;
}

function isPromise(value) {
    return !!value && typeof value.then === 'function';
}

function revokeUrl(value) {
    if (typeof value !== 'string' || !value.startsWith('blob:')) {
        return;
    }

    try {
        URL.revokeObjectURL(value);
    } catch {}
}

function trimAudioCache() {
    if (audioCache.size <= MAX_AUDIO_CACHE) {
        return;
    }

    for (const [key, entry] of audioCache.entries()) {
        if (audioCache.size <= MAX_AUDIO_CACHE) {
            break;
        }
        if (!entry || entry.status !== 'ready' || entry.refs > 0) {
            continue;
        }

        audioCache.delete(key);
        revokeUrl(entry.url);
    }
}

function getReadyEntry(key) {
    const entry = audioCache.get(key);
    return entry?.status === 'ready' ? entry : null;
}

function retainAudio(key) {
    const entry = getReadyEntry(key);
    if (!entry) {
        return null;
    }

    audioCache.set(key, {
        ...entry,
        refs: entry.refs + 1,
    });
    return entry.url;
}

function releaseAudio(key) {
    const entry = getReadyEntry(key);
    if (!entry) {
        return;
    }

    audioCache.set(key, {
        ...entry,
        refs: Math.max(0, entry.refs - 1),
    });
}

function setPendingEntry(key, promise) {
    audioCache.set(key, {
        status: 'pending',
        promise,
    });
}

function setReadyEntry(key, url) {
    const previous = getReadyEntry(key);
    if (previous?.url && previous.url !== url) {
        revokeUrl(previous.url);
    }

    audioCache.set(key, {
        status: 'ready',
        url,
        refs: previous?.refs ?? 0,
    });
    trimAudioCache();
    return url;
}

export default function AudioMessage({ msg, peerChatPK, fromPeer = false }) {
    const { readMessageFile } = useChat();
    const { cloaked } = useCloak();
    const audioRef = useRef(null);
    const [src, setSrc] = useState(() => (!isExpiredAttachmentMsg(msg) && typeof msg?.localUri === 'string' && msg.localUri ? msg.localUri : ''));
    const [loading, setLoading] = useState(() => msg?.t === 'mp3' && !msg?.localUri && !!msg?.p && !!msg?.k);
    const [error, setError] = useState('');
    const [playing, setPlaying] = useState(false);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(Number.isFinite(msg?.d) ? msg.d : 0);
    const title = getAttachmentTitle(msg);
    const caption = getAttachmentCaption(msg);

    useEffect(
        () => () => {
            if (audioRef.current) {
                clear(audioRef.current);
            }
        },
        []
    );

    useEffect(() => {
        let cancelled = false;
        let retainedKey = null;
        const expired = isExpiredAttachmentMsg(msg);
        const localUri = !expired && typeof msg?.localUri === 'string' && msg.localUri ? msg.localUri : '';
        if (localUri) {
            setSrc(localUri);
            setLoading(false);
            setError('');
            return;
        }

        if (msg?.t !== 'mp3' || !peerChatPK || !msg?.p || !msg?.k) {
            setSrc('');
            setLoading(false);
            setError('');
            return;
        }

        const key = getCacheKey(peerChatPK, msg);
        const cached = expired ? null : audioCache.get(key);
        const cachedUrl = expired ? null : retainAudio(key);
        if (cachedUrl) {
            retainedKey = key;
            setSrc(cachedUrl);
            setLoading(false);
            setError('');
            setPlaying(false);
            return () => {
                releaseAudio(retainedKey);
            };
        }

        setLoading(true);
        setError('');
        setTime(0);
        setPlaying(false);

        const task =
            cached?.status === 'pending' && isPromise(cached.promise)
                ? cached.promise
                : Promise.resolve(readMessageFile(peerChatPK, msg))
                      .then((bytes) => {
                          const objectUrl = URL.createObjectURL(new Blob([bytes], { type: msg?.m || 'audio/mpeg' }));
                          return setReadyEntry(key, objectUrl);
                      })
                      .catch((nextError) => {
                          audioCache.delete(key);
                          throw nextError;
                      });

        if (!(cached?.status === 'pending' && cached.promise === task)) {
            setPendingEntry(key, task);
        }

        task.then((objectUrl) => {
            if (cancelled) {
                return;
            }
            retainAudio(key);
            retainedKey = key;
            setSrc(objectUrl);
            setLoading(false);
        }).catch((nextError) => {
            if (cancelled) {
                return;
            }
            console.warn('chat audio load failed', nextError);
            setError(nextError?.message || 'audio unavailable');
            setLoading(false);
        });

        return () => {
            cancelled = true;
            if (retainedKey) {
                releaseAudio(retainedKey);
            }
        };
    }, [msg?.k, msg?.localUri, msg?.m, msg?.p, msg?.t, peerChatPK, readMessageFile]);

    const toggle = useCallback(
        (event) => {
            stopClick(event);
            const audio = audioRef.current;
            if (!audio || !src || loading || error) {
                return;
            }

            if (audio.paused) {
                play(audio);
                void audio.play().catch((nextError) => {
                    console.error('chat audio play failed', nextError);
                    clear(audio);
                    setError(nextError?.message || 'audio unavailable');
                });
            } else {
                audio.pause();
                clear(audio);
            }
        },
        [error, loading, src]
    );

    const seek = useCallback((event) => {
        const audio = audioRef.current;
        if (!audio) {
            return;
        }
        const next = Number(event.target.value);
        audio.currentTime = Number.isFinite(next) ? next : 0;
        setTime(audio.currentTime);
    }, []);

    const disabled = loading || !!error || !src;
    const max = duration > 0 ? duration : 0;
    const timeLabel = loading ? 'loading...' : error || `${fmtTime(time)} / ${fmtTime(duration)}`;

    return (
        <div className={`flex min-w-0 w-xs max-w-full items-center gap-3 rounded-round ${bubbleBg(fromPeer)} pl-4 pr-4 py-3 shadow-sm`}>
            <button
                type="button"
                className="flex h-10 w-8 shrink-0 items-center justify-center transition-transform hover:scale-120 active:scale-85 disabled:cursor-default disabled:opacity-50 disabled:hover:scale-100"
                onClick={toggle}
                disabled={disabled}
                title={playing ? 'pause audio' : 'play audio'}
            >
                {loading ? <Loader className="size-5 animate-spin" /> : playing ? <Pause className="size-6 fill-current stroke-0" /> : <Play className="size-6 fill-current stroke-0" />}
            </button>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-3">
                    <p className={`min-w-0 flex-1 truncate font-black ${cloaked ? 'cloaked' : ''}`}>{title}</p>
                    <p className="shrink-0 text-sm tabular-nums text-muted">{timeLabel}</p>
                </div>
                <input type="range" min="0" max={max || 1} step="0.01" value={Math.min(time, max || 0)} onChange={seek} disabled={!src} className="mt-2 block w-full accent-foreground" />
                {caption ? <p className={`mt-2 wrap-break-word whitespace-pre-wrap text-sm ${cloaked ? 'cloaked' : ''}`}>{caption}</p> : null}
            </div>
            <audio
                ref={audioRef}
                src={src || undefined}
                preload="metadata"
                onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                onTimeUpdate={(event) => setTime(event.currentTarget.currentTime || 0)}
                onPlay={(event) => {
                    play(event.currentTarget);
                    setPlaying(true);
                }}
                onPause={(event) => {
                    clear(event.currentTarget);
                    setPlaying(false);
                }}
                onEnded={(event) => {
                    clear(event.currentTarget);
                    setPlaying(false);
                }}
                onError={(event) => setError(event.currentTarget.error?.message || 'audio unavailable')}
            />
        </div>
    );
}
