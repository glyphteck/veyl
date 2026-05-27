'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useUser } from '@/components/providers/userprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { formatUserDisplay, renderMoney } from '@/lib/utils';
import { toast } from 'sonner';
import { Loader, Coins, ArrowUpRight, X, Download } from 'lucide-react';
import { qr, readQr } from '@glyphteck/shared/qrutils';
import { isAddressOnNetwork } from '@glyphteck/shared/network';
import { randomBytes, toHex } from '@glyphteck/shared/crypto/core';

const SCAN_INTERVAL = 200;
const VIDEO_HOLD_MS = 220;
const VIDEO_FRAME_RATE = 30;

function getVideoMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    const types = ['video/mp4;codecs=h264,aac', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return types.find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
}

function videoFileType(mimeType) {
    return String(mimeType || '').includes('mp4') ? 'video/mp4' : 'video/webm';
}

function videoFileName(mimeType) {
    const ext = videoFileType(mimeType) === 'video/mp4' ? 'mp4' : 'webm';
    return makeCaptureName(ext);
}

function makeCaptureName(ext) {
    const cleanExt = String(ext || '').replace(/^\./, '').toLowerCase() || 'bin';
    return `${toHex(randomBytes(8))}.${cleanExt}`;
}

function makeRecordingStream(video) {
    const source = video?.srcObject;
    if (!source || typeof source.getVideoTracks !== 'function') {
        throw new Error('camera stream unavailable');
    }

    if (!video || typeof document === 'undefined') {
        return { stream: source, stop: () => {} };
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.captureStream !== 'function') {
        return { stream: source, stop: () => {} };
    }

    let frame = null;
    let active = true;
    const draw = () => {
        if (!active) return;
        const width = video.videoWidth || video.clientWidth || 1280;
        const height = video.videoHeight || video.clientHeight || 720;
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        ctx.save();
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, width, height);
        ctx.restore();
        frame = requestAnimationFrame(draw);
    };

    draw();
    const stream = canvas.captureStream(VIDEO_FRAME_RATE);
    return {
        stream,
        stop: () => {
            active = false;
            if (frame) cancelAnimationFrame(frame);
            stream.getTracks().forEach((track) => track.stop());
        },
    };
}

function mirrorPhotoDataUri(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;
            if (!width || !height) {
                reject(new Error('photo unavailable'));
                return;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('canvas unavailable'));
                return;
            }

            ctx.translate(width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.92));
        };
        img.onerror = reject;
        img.src = src;
    });
}

export default function CameraPage() {
    const webcamRef = useRef(null);
    const detectorRef = useRef(null);
    const scanTimer = useRef(null);
    const busyRef = useRef(false);
    const recorderRef = useRef(null);
    const recordChunksRef = useRef([]);
    const recordSessionRef = useRef(null);
    const pointerRef = useRef({ id: null, timer: null, long: false });
    const captureRef = useRef(null);
    const recordingRef = useRef(false);
    const { openDialog } = useDialog();
    const { addPeer } = usePeer();
    const { settings, username, walletPK } = useUser();
    const bitcoin = useBitcoin();
    const { sendMoneyWithSpark, network } = useWallet();
    const { cloaked } = useCloak();
    const [capture, setCapture] = useState(null);
    const [recording, setRecording] = useState(false);

    useEffect(() => {
        captureRef.current = capture;
        return () => {
            if (capture?.revokeUrl) URL.revokeObjectURL(capture.uri);
        };
    }, [capture]);

    useEffect(() => {
        recordingRef.current = recording;
    }, [recording]);

    const handleQr = useCallback(
        async (rawValue) => {
            if (!rawValue || busyRef.current) return;
            busyRef.current = true;
            try {
                const qrData = readQr(rawValue.trim());

                if (qrData?.kind === qr.user && qrData.username) {
                    if (qrData.username === username) return;
                    const peer = await addPeer({ username: qrData.username });
                    if (!peer) {
                        toast.error('user not found');
                        return;
                    }
                    openDialog('payments', { peer, tab: 'send' });
                    return;
                }

                if (qrData?.kind === qr.request && qrData.to) {
                    if (qrData.to === walletPK) return;
                    const peer = await addPeer({ walletPK: qrData.to });
                    if (!peer) {
                        toast.error('user not found');
                        return;
                    }

                    if (settings.sendOnScan && qrData.amount) {
                        const displayName = formatUserDisplay(peer, false);
                        const formattedAmount = renderMoney(qrData.amount.toString(), settings.moneyFormat, bitcoin.price);
                        const loadingToastId = toast(cloaked ? `sending money to ${displayName}` : `sending ${formattedAmount} to ${displayName}`, {
                            icon: <Loader className="animate-spin" />,
                            duration: Infinity,
                        });
                        try {
                            await sendMoneyWithSpark(peer.walletPK, qrData.amount.toString());
                            toast.success(cloaked ? `sent money to ${displayName}` : `sent ${formattedAmount} to ${displayName}`, {
                                id: loadingToastId,
                                icon: <Coins />,
                                duration: 2000,
                            });
                        } catch (error) {
                            toast.error(error.message || 'failed to send money', {
                                id: loadingToastId,
                                duration: 2000,
                            });
                        }
                        return;
                    }

                    openDialog('payments', { peer, tab: 'send', amount: qrData.amount ?? null });
                    return;
                }

                if (qrData?.kind === qr.bitcoin && qrData.address) {
                    if (!isAddressOnNetwork(qrData.address, network)) {
                        toast.error(`wrong network — not a ${network.toLowerCase()} address`);
                        return;
                    }
                    openDialog('withdraw', { address: qrData.address });
                    return;
                }
            } catch (err) {
                console.error('QR handling failed:', err);
            } finally {
                setTimeout(() => {
                    busyRef.current = false;
                }, 1000);
            }
        },
        [addPeer, bitcoin, cloaked, network, openDialog, sendMoneyWithSpark, settings, username, walletPK]
    );

    useEffect(() => {
        if (capture || recording) return;
        if (typeof globalThis.BarcodeDetector === 'undefined') {
            console.warn('BarcodeDetector not supported');
            return;
        }

        if (!detectorRef.current) {
            detectorRef.current = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
        }

        let cancelled = false;
        const tick = async () => {
            if (cancelled) return;
            const video = webcamRef.current?.video;
            if (!video || video.readyState < 2 || busyRef.current) {
                scanTimer.current = setTimeout(tick, SCAN_INTERVAL);
                return;
            }

            try {
                const codes = await detectorRef.current.detect(video);
                if (codes?.length && !busyRef.current) {
                    await handleQr(codes[0].rawValue);
                }
            } catch {
                // detect can throw on invalid frames
            }

            if (!cancelled) {
                scanTimer.current = setTimeout(tick, SCAN_INTERVAL);
            }
        };

        tick();
        return () => {
            cancelled = true;
            clearTimeout(scanTimer.current);
        };
    }, [capture, handleQr, recording]);

    const takePhoto = useCallback(async () => {
        const src = webcamRef.current?.getScreenshot();
        if (!src) return;
        const name = makeCaptureName('jpg');
        try {
            setCapture({ kind: 'photo', uri: await mirrorPhotoDataUri(src), name });
        } catch (error) {
            console.error('photo mirror failed:', error);
            setCapture({ kind: 'photo', uri: src, name });
        }
    }, []);

    const stopVideo = useCallback(() => {
        const recorder = recorderRef.current;
        if (recorder?.state === 'recording') {
            recorder.stop();
            return;
        }
        recordSessionRef.current?.stop?.();
        recordSessionRef.current = null;
        recorderRef.current = null;
        recordingRef.current = false;
        setRecording(false);
    }, []);

    const startVideo = useCallback(() => {
        if (captureRef.current || recordingRef.current) return;
        if (typeof MediaRecorder === 'undefined') {
            toast.error('video recording is unavailable');
            return;
        }

        const video = webcamRef.current?.video;
        if (!video || video.readyState < 2) {
            toast.error('camera is not ready');
            return;
        }

        const mimeType = getVideoMimeType();
        let session;
        let recorder;
        try {
            session = makeRecordingStream(video);
            recorder = new MediaRecorder(session.stream, mimeType ? { mimeType } : undefined);
        } catch (error) {
            session?.stop?.();
            console.error('video recording failed:', error);
            toast.error('video recording is unavailable');
            return;
        }
        recordChunksRef.current = [];
        recordSessionRef.current = session;
        recorderRef.current = recorder;
        recordingRef.current = true;
        setRecording(true);

        recorder.ondataavailable = (event) => {
            if (event.data?.size) recordChunksRef.current.push(event.data);
        };
        recorder.onerror = () => {
            console.error('video recording failed:', recorder.error);
            session.stop();
            recorderRef.current = null;
            recordSessionRef.current = null;
            recordChunksRef.current = [];
            recordingRef.current = false;
            setRecording(false);
        };
        recorder.onstop = () => {
            const chunks = recordChunksRef.current;
            const recordedType = videoFileType(recorder.mimeType || mimeType);
            session.stop();
            recorderRef.current = null;
            recordSessionRef.current = null;
            recordChunksRef.current = [];
            recordingRef.current = false;
            setRecording(false);
            if (!chunks.length) return;

            const blob = new Blob(chunks, { type: recordedType });
            if (!blob.size) return;
            const file = new File([blob], videoFileName(recordedType), { type: recordedType, lastModified: Date.now() });
            setCapture({
                kind: 'video',
                uri: URL.createObjectURL(blob),
                file,
                revokeUrl: true,
            });
        };
        recorder.start();
    }, []);

    useEffect(() => () => stopVideo(), [stopVideo]);

    const discardCapture = useCallback(() => {
        setCapture(null);
    }, []);

    const handleSend = useCallback(() => {
        if (!capture) return;
        openDialog('sendphoto', {
            media: capture,
            ...(capture.kind === 'photo' ? { photo: capture.uri } : {}),
            onSent: () => setCapture(null),
        });
    }, [capture, openDialog]);

    const handleSave = useCallback(() => {
        if (!capture) return;
        const a = document.createElement('a');
        a.href = capture.uri;
        a.download = capture.kind === 'video' ? capture.file?.name || videoFileName(capture.file?.type) : capture.name || makeCaptureName('jpg');
        a.click();
    }, [capture]);

    const clearPointerTimer = useCallback(() => {
        if (pointerRef.current.timer) {
            clearTimeout(pointerRef.current.timer);
            pointerRef.current.timer = null;
        }
    }, []);

    const handleShutterDown = useCallback(
        (event) => {
            if (captureRef.current || recordingRef.current) return;
            pointerRef.current.id = event.pointerId;
            pointerRef.current.long = false;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            clearPointerTimer();
            pointerRef.current.timer = setTimeout(() => {
                pointerRef.current.timer = null;
                pointerRef.current.long = true;
                startVideo();
            }, VIDEO_HOLD_MS);
        },
        [clearPointerTimer, startVideo]
    );

    const handleShutterUp = useCallback(
        (event) => {
            const active = pointerRef.current.id === event.pointerId;
            if (!active) return;
            const wasLong = pointerRef.current.long;
            pointerRef.current.id = null;
            pointerRef.current.long = false;
            clearPointerTimer();
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            if (wasLong) {
                stopVideo();
                return;
            }
            takePhoto();
        },
        [clearPointerTimer, stopVideo, takePhoto]
    );

    const handleShutterCancel = useCallback(
        (event) => {
            const active = pointerRef.current.id === event.pointerId;
            pointerRef.current.id = null;
            pointerRef.current.long = false;
            clearPointerTimer();
            if (active) stopVideo();
        },
        [clearPointerTimer, stopVideo]
    );

    return (
        <div className="h-full relative overflow-hidden rounded-round">
            <div className="absolute inset-0">
                <div className="absolute inset-0 -scale-x-100">
                    <Webcam
                        ref={webcamRef}
                        audio={false}
                        screenshotFormat="image/jpeg"
                        videoConstraints={{ facingMode: 'environment' }}
                        className={`absolute inset-0 w-full h-full object-cover transition-all duration-300 ${cloaked ? 'blur-3xl scale-110' : ''}`}
                    />
                </div>
                {capture?.kind === 'photo' && <img src={capture.uri} alt="preview" className="absolute inset-0 w-full h-full object-cover" />}
                {capture?.kind === 'video' && <video src={capture.uri} className="absolute inset-0 w-full h-full object-cover" autoPlay loop muted playsInline />}
            </div>
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-8">
                {capture ? (
                    <>
                        <button onClick={discardCapture} className="backdrop-blur-sm size-12 rounded-full bg-background/70 grower cursor-pointer flex items-center justify-center">
                            <X className="size-5 text-foreground" />
                        </button>
                        <button onClick={handleSend} className="backdrop-blur-sm size-18 rounded-full bg-foreground/70 grower cursor-pointer flex items-center justify-center">
                            <ArrowUpRight className="size-8 text-background" />
                        </button>
                        <button onClick={handleSave} className="backdrop-blur-sm size-12 rounded-full bg-background/70 grower cursor-pointer flex items-center justify-center">
                            <Download className="size-5 text-foreground" />
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        aria-label={recording ? 'recording video' : 'take photo'}
                        onPointerDown={handleShutterDown}
                        onPointerUp={handleShutterUp}
                        onPointerCancel={handleShutterCancel}
                        onLostPointerCapture={recording ? stopVideo : undefined}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                takePhoto();
                            }
                        }}
                        className={`backdrop-blur-md size-18 rounded-full shadow grower cursor-pointer ${recording ? 'bg-destructive/75' : 'bg-background/70'}`}
                    />
                )}
            </div>
        </div>
    );
}
