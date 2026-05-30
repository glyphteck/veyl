'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader, Pause, Play } from 'lucide-react';
import { useChat } from '@/components/providers/chatprovider';
import { bubbleBg } from '@/lib/messages';
import { clear, play } from '@/lib/media';
import { getAudioCacheKey, loadAudioObjectUrl, releaseAudio, retainAudio } from '@/components/chat/audiocache';
import { getAttachmentCaption, getAttachmentTitle, isExpiredAttachmentMsg } from '@glyphteck/shared/chat/messages';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { formatDuration } from '@glyphteck/shared/utils';
import { stopClick } from './utils';

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

        if (expired) {
            setSrc('');
            setLoading(false);
            setError('audio unavailable');
            setPlaying(false);
            return;
        }

        if (msg?.t !== 'mp3' || !peerChatPK || !msg?.p || !msg?.k) {
            setSrc('');
            setLoading(false);
            setError('');
            return;
        }

        const key = getAudioCacheKey(peerChatPK, msg);
        const cachedUrl = retainAudio(key);
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

        const task = loadAudioObjectUrl(peerChatPK, msg, readMessageFile);

        task.then((objectUrl) => {
            if (cancelled) {
                return;
            }
            if (!objectUrl) {
                setSrc('');
                setLoading(false);
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
    const timeLabel = loading ? 'loading...' : error || `${formatDuration(time, { hours: false })} / ${formatDuration(duration, { hours: false })}`;

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
