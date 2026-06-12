'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader, Pause, Play } from 'lucide-react';
import { useChat } from '@/components/providers/chatprovider';
import { bubbleBg, stopClick } from '@/lib/chat/messages';
import { clear, play } from '@/lib/media/playback';
import { getAudioCacheKey, loadAudioObjectUrl, releaseAudio, retainAudio } from '@/lib/chat/audiocache';
import { getAttachmentCaption, getAttachmentTitle, hasStoredFileRef, isExpiredAttachmentMsg } from '@veyl/shared/chat/messages';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { formatDuration } from '@veyl/shared/utils/time';

const AUDIO_BUBBLE_WIDTH = 320;
const AUDIO_REPLY_SCALE = 0.56;

export function AudioBubble({ msg, fromPeer = false, loading = false, playing = false, disabled = false, inactive = false, compact = false, time = 0, duration: durationProp, timeLabel, onToggle, onSeek }) {
    const { cloaked } = useCloak();
    const title = getAttachmentTitle(msg);
    const caption = getAttachmentCaption(msg);
    const duration = Number.isFinite(durationProp) ? durationProp : Number.isFinite(msg?.d) ? msg.d : 0;
    const currentTime = Number.isFinite(time) ? time : 0;
    const max = duration > 0 ? duration : 0;
    const value = Math.min(currentTime, max || 0);
    const label = timeLabel || `${formatDuration(currentTime, { hours: false })} / ${formatDuration(duration, { hours: false })}`;
    const compactWidth = Math.round(Math.min(160, AUDIO_BUBBLE_WIDTH * AUDIO_REPLY_SCALE));
    const canSeek = typeof onSeek === 'function' && !inactive;
    const buttonDisabled = disabled || inactive || typeof onToggle !== 'function';
    const controlClassName = `${compact ? 'h-8 w-6' : 'h-10 w-8 transition-transform hover:scale-120 active:scale-85 disabled:hover:scale-100'} flex shrink-0 items-center justify-center ${inactive ? 'opacity-50' : 'disabled:cursor-default disabled:opacity-50'}`;
    const controlIcon = loading ? <Loader className={`${compact ? 'size-4' : 'size-5'} animate-spin`} /> : playing ? <Pause className={`${compact ? 'size-5' : 'size-6'} fill-current stroke-0`} /> : <Play className={`${compact ? 'size-5' : 'size-6'} fill-current stroke-0`} />;

    return (
        <div
            className={`flex min-w-0 max-w-full items-center ${compact ? 'gap-2 rounded-[20px] px-2.5 py-2 opacity-65' : 'w-xs gap-3 rounded-round py-3 pl-4 pr-4'} ${bubbleBg(fromPeer)} shadow-sm`}
            style={compact ? { width: compactWidth, maxWidth: '100%' } : undefined}
        >
            {inactive ? (
                <span className={controlClassName} aria-hidden="true">
                    {controlIcon}
                </span>
            ) : (
                <button type="button" className={controlClassName} onClick={onToggle} disabled={buttonDisabled} title={playing ? 'pause audio' : 'play audio'}>
                    {controlIcon}
                </button>
            )}
            <div className="min-w-0 flex-1">
                <div className={`flex min-w-0 items-center ${compact ? 'gap-2' : 'gap-3'}`}>
                    <p className={`min-w-0 flex-1 truncate font-black ${compact ? 'text-sm' : ''} ${cloaked ? 'cloaked' : ''}`}>{title}</p>
                    {compact ? null : <p className="shrink-0 text-sm tabular-nums text-muted">{label}</p>}
                </div>
                {canSeek ? (
                    <input type="range" min="0" max={max || 1} step="0.01" value={value} onChange={onSeek} disabled={disabled} className={`${compact ? 'mt-1' : 'mt-2'} block w-full accent-foreground`} />
                ) : (
                    <div className={`${compact ? 'mt-1 h-3' : 'mt-2 h-4'} flex w-full items-center opacity-50`}>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/15">
                            <div className="h-full bg-foreground" style={{ width: max > 0 ? `${Math.max(0, Math.min(1, value / max)) * 100}%` : '0%' }} />
                        </div>
                    </div>
                )}
                {caption ? <p className={`${compact ? 'mt-1.5 truncate text-xs' : 'mt-2 wrap-break-word whitespace-pre-wrap text-sm'} ${cloaked ? 'cloaked' : ''}`}>{caption}</p> : null}
            </div>
        </div>
    );
}

export default function AudioMessage({ msg, peerChatPK, fromPeer = false }) {
    const { readMessageFile } = useChat();
    const audioRef = useRef(null);
    const [src, setSrc] = useState(() => (!isExpiredAttachmentMsg(msg) && typeof msg?.localUri === 'string' && msg.localUri ? msg.localUri : ''));
    const [loading, setLoading] = useState(() => msg?.t === 'm4a' && !msg?.localUri && hasStoredFileRef(msg));
    const [error, setError] = useState('');
    const [playing, setPlaying] = useState(false);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(Number.isFinite(msg?.d) ? msg.d : 0);
    const title = getAttachmentTitle(msg);

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

        if (msg?.t !== 'm4a' || !peerChatPK || !hasStoredFileRef(msg)) {
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
    const timeLabel = loading ? 'loading...' : error || `${formatDuration(time, { hours: false })} / ${formatDuration(duration, { hours: false })}`;

    return (
        <>
            <AudioBubble msg={msg} fromPeer={fromPeer} loading={loading} playing={playing} disabled={disabled} time={time} duration={duration} timeLabel={timeLabel} onToggle={toggle} onSeek={seek} />
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
        </>
    );
}
