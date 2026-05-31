'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader, Pause, Play } from 'lucide-react';
import { useChat } from '@/components/providers/chatprovider';
import { imageWidth, stopClick } from '@/lib/chat/messages';
import { clear, play } from '@/lib/media/playback';
import { getAttachmentCaption, getImageAspect, hasStoredFileRef, isExpiredAttachmentMsg } from '@veyl/shared/chat/messages';
import { getMessagePreviewCacheKey } from '@veyl/shared/chat/previews';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { formatDuration } from '@veyl/shared/utils/time';
import { getReadyPoster, getVideoCacheKey, loadVideoObjectUrl, loadVideoPoster, releaseVideo, retainVideo } from '@/lib/chat/videocache';

export default function VideoMessage({ msg, peerChatPK }) {
    const { readMessageFile, readMessagePreview, writeMessagePreview } = useChat();
    const { cloaked } = useCloak();
    const videoRef = useRef(null);
    const cacheKey = getVideoCacheKey(peerChatPK, msg);
    const posterKey = getMessagePreviewCacheKey(peerChatPK, msg) || cacheKey;
    const expired = isExpiredAttachmentMsg(msg);
    const [src, setSrc] = useState(() => (!expired && typeof msg?.localUri === 'string' && msg.localUri ? msg.localUri : ''));
    const [loading, setLoading] = useState(() => msg?.t === 'mp4' && !msg?.localUri && hasStoredFileRef(msg));
    const [error, setError] = useState('');
    const [playing, setPlaying] = useState(false);
    const [rowHover, setRowHover] = useState(false);
    const [surfaceHover, setSurfaceHover] = useState(false);
    const [poster, setPoster] = useState(() => (expired ? '' : getReadyPoster(posterKey)));
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(Number.isFinite(msg?.d) ? msg.d : 0);
    const aspect = getImageAspect(msg, 16 / 9);
    const width = imageWidth(aspect);
    const caption = getAttachmentCaption(msg);
    const controlsVisible = playing ? surfaceHover : rowHover;

    useEffect(
        () => () => {
            if (videoRef.current) {
                clear(videoRef.current);
            }
        },
        []
    );

    useEffect(() => {
        setPlaying(false);
        setTime(0);
    }, [src]);

    useEffect(() => {
        if (!posterKey || error || expired) {
            setPoster('');
            return;
        }

        const cachedPoster = getReadyPoster(posterKey);
        if (cachedPoster) {
            setPoster(cachedPoster);
            return;
        }

        let cancelled = false;
        loadVideoPoster(posterKey, src, msg, readMessagePreview, writeMessagePreview)
            .then((nextPoster) => {
                if (!cancelled) {
                    setPoster(nextPoster);
                }
            })
            .catch((nextError) => {
                if (!cancelled && src) {
                    console.warn('chat video poster failed', nextError);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [error, expired, msg, posterKey, readMessagePreview, src, writeMessagePreview]);

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

        if (msg?.t !== 'mp4' || !peerChatPK || !hasStoredFileRef(msg)) {
            setSrc('');
            setLoading(false);
            setError('');
            return;
        }

        const key = getVideoCacheKey(peerChatPK, msg);
        const cachedUrl = retainVideo(key);
        if (cachedUrl) {
            retainedKey = key;
            setSrc(cachedUrl);
            setLoading(false);
            setError('');
            setPlaying(false);
            return () => {
                releaseVideo(retainedKey);
            };
        }

        setLoading(true);
        setError('');

        const task = loadVideoObjectUrl(peerChatPK, msg, readMessageFile);

        task.then(async (objectUrl) => {
            if (cancelled) {
                return;
            }
            const nextPoster =
                getReadyPoster(posterKey) ||
                (await loadVideoPoster(posterKey, objectUrl, msg, readMessagePreview, writeMessagePreview).catch(() => ''));
            if (cancelled) {
                return;
            }
            if (nextPoster) {
                setPoster(nextPoster);
            }
            retainVideo(key);
            retainedKey = key;
            setSrc(objectUrl);
            setLoading(false);
        }).catch((nextError) => {
            if (cancelled) return;
            console.warn('chat video load failed', nextError);
            setError(nextError?.message || 'video unavailable');
            setLoading(false);
        });

        return () => {
            cancelled = true;
            if (retainedKey) {
                releaseVideo(retainedKey);
            }
        };
    }, [msg?.k, msg?.localUri, msg?.m, msg?.p, msg?.t, peerChatPK, posterKey, readMessageFile, readMessagePreview, writeMessagePreview]);

    const toggle = useCallback(
        (event) => {
            stopClick(event);
            if (!src || loading || error) return;

            const video = videoRef.current;
            if (!video) return;

            if (video.paused) {
                play(video);
                if (duration > 0 && video.currentTime >= duration) video.currentTime = 0;
                void video.play();
                return;
            }
            video.pause();
            clear(video);
        },
        [duration, error, loading, src]
    );

    const seek = useCallback((event) => {
        const video = videoRef.current;
        if (!video) return;
        const next = Number(event.target.value);
        video.currentTime = Number.isFinite(next) ? next : 0;
        setTime(video.currentTime);
    }, []);

    return (
        <div className="overflow-hidden rounded-round bg-foreground/5 shadow-sm" style={{ width, maxWidth: '100%' }} onClick={stopClick} onMouseEnter={() => setRowHover(true)} onMouseLeave={() => setRowHover(false)}>
            <div
                className="relative bg-foreground/5"
                style={{ width: '100%', aspectRatio: aspect }}
                onClick={toggle}
                onMouseEnter={() => setSurfaceHover(true)}
                onMouseLeave={() => setSurfaceHover(false)}
            >
                {src ? (
                    <video
                        ref={videoRef}
                        src={src}
                        poster={poster || undefined}
                        loop
                        playsInline
                        preload="metadata"
                        className={`block size-full object-cover ${cloaked ? 'blur-xl saturate-0' : ''}`}
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
                        onError={(event) => setError(event.currentTarget.error?.message || 'video unavailable')}
                    />
                ) : (
                    <div className="flex size-full items-center justify-center">
                        {loading ? <Loader className="size-5 animate-spin text-muted" /> : error ? <span className="text-sm text-muted">{error}</span> : null}
                    </div>
                )}
                {src && !playing && !loading && !error ? (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
                        <span className="flex size-14 items-center justify-center rounded-full bg-black/35" style={{ WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)' }}>
                            <Play className="size-8 fill-current stroke-0" />
                        </span>
                    </div>
                ) : null}
                <div className={`absolute inset-0 text-white transition-opacity will-change-opacity ${controlsVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}>
                    {playing ? (
                        <button
                            type="button"
                            className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 disabled:opacity-45"
                            style={{ WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)' }}
                            onClick={toggle}
                            disabled={!src || loading || !!error}
                        >
                            <Pause className="size-8 fill-current stroke-0" />
                        </button>
                    ) : null}
                    <div className="absolute inset-x-3 bottom-2" onClick={stopClick}>
                        <span className="mb-1 ml-auto block w-fit rounded-full bg-black/30 px-2 py-1 text-xs font-bold tabular-nums" style={{ WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)' }}>
                            {formatDuration(time, { hours: false })} / {formatDuration(duration, { hours: false })}
                        </span>
                        <div className="flex items-center rounded-full bg-black/30 px-2 py-1" style={{ WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)' }}>
                            <input type="range" min="0" max={duration || 1} step="0.01" value={Math.min(time, duration || 0)} onChange={seek} disabled={!src} className="block w-full accent-white" />
                        </div>
                    </div>
                </div>
            </div>
            {caption ? <p className={`px-3 py-2 text-sm wrap-break-word whitespace-pre-wrap ${cloaked ? 'cloaked' : ''}`}>{caption}</p> : null}
        </div>
    );
}
