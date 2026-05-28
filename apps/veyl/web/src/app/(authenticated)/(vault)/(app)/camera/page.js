'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useUser } from '@/components/providers/userprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { formatUserDisplay, renderMoney } from '@/lib/utils';
import { toast } from 'sonner';
import { Loader, Coins, ArrowUpRight, X, Download, Lock } from 'lucide-react';
import { qr, readQr } from '@glyphteck/shared/qrutils';
import { isAddressOnNetwork } from '@glyphteck/shared/network';
import { randomBytes, toHex } from '@glyphteck/shared/crypto/core';

const SCAN_INTERVAL = 200;
const VIDEO_HOLD_MS = 220;
const VIDEO_FRAME_RATE = 30;
const LOCK_SLIDE_DISTANCE = 58;
const LOCK_AXIS_RATIO = 1.2;
const LOCK_VERTICAL_FAIL = 44;
const NAV_FOCUSABLE_SELECTOR = 'nav button:not(:disabled), nav [href], nav input:not(:disabled), nav select:not(:disabled), nav textarea:not(:disabled), nav [tabindex]:not([tabindex="-1"])';

function shutterKeyValue(event) {
    if (event.key === 'Enter') return 'Enter';
    if (event.key === ' ' || event.code === 'Space') return ' ';
    return '';
}

function isLockKey(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    const key = String(event.key || '').toLowerCase();
    return key === 'l' || event.key === 'ArrowLeft' || event.key === 'ArrowRight';
}

function visibleFocusable(element) {
    return !!element && element.tabIndex >= 0 && !element.disabled && element.getClientRects().length > 0;
}

function focusFirstNavbarItem() {
    const item = [...(document.querySelectorAll?.(NAV_FOCUSABLE_SELECTOR) || [])].find(visibleFocusable);
    item?.focus?.({ preventScroll: true });
}

function isHorizontalLockSlide(event, start) {
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const dx = x - Number(start?.startX || 0);
    const dy = y - Number(start?.startY || 0);
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ay > LOCK_VERTICAL_FAIL && ay > ax * LOCK_AXIS_RATIO) return false;

    const rect = event.currentTarget?.getBoundingClientRect?.();
    const leftRightExit = rect && (x < rect.left || x > rect.right) && ax > ay * LOCK_AXIS_RATIO;
    return leftRightExit || (ax >= LOCK_SLIDE_DISTANCE && ax > ay * LOCK_AXIS_RATIO);
}

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
    const pointerRef = useRef({ id: null, timer: null, long: false, startX: 0, startY: 0 });
    const keyRef = useRef({ active: false, key: '', timer: null, long: false });
    const shutterRef = useRef(null);
    const actionRefs = useRef([]);
    const captureRef = useRef(null);
    const recordingRef = useRef(false);
    const recordingLockedRef = useRef(false);
    const { openDialog } = useDialog();
    const { addPeer } = usePeer();
    const { settings, username, walletPK } = useUser();
    const bitcoin = useBitcoin();
    const { sendMoneyWithSpark, network } = useWallet();
    const { cloaked } = useCloak();
    const [capture, setCapture] = useState(null);
    const [recording, setRecording] = useState(false);
    const [recordingLocked, setRecordingLocked] = useState(false);
    const [shutterPressed, setShutterPressed] = useState(false);
    const [initialSendFocus, setInitialSendFocus] = useState(false);

    const focusShutter = useCallback(() => {
        shutterRef.current?.focus({ preventScroll: true });
    }, []);

    const focusAction = useCallback((index = 0) => {
        const actions = actionRefs.current.filter(visibleFocusable);
        if (!actions.length) return;
        actions[((index % actions.length) + actions.length) % actions.length]?.focus({ preventScroll: true });
    }, []);

    useEffect(() => {
        captureRef.current = capture;
        return () => {
            if (capture?.revokeUrl) URL.revokeObjectURL(capture.uri);
        };
    }, [capture]);

    useEffect(() => {
        recordingRef.current = recording;
    }, [recording]);

    useLayoutEffect(() => {
        setInitialSendFocus(!!capture);
    }, [capture]);

    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            if (capture) {
                focusAction(1);
                return;
            }
            focusShutter();
        });
        return () => cancelAnimationFrame(frame);
    }, [capture, focusAction, focusShutter]);

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
        recordingLockedRef.current = false;
        setRecordingLocked(false);
        setShutterPressed(false);
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
        recordingLockedRef.current = false;
        setRecording(true);
        setRecordingLocked(false);

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
            recordingLockedRef.current = false;
            setRecording(false);
            setRecordingLocked(false);
            setShutterPressed(false);
        };
        recorder.onstop = () => {
            const chunks = recordChunksRef.current;
            const recordedType = videoFileType(recorder.mimeType || mimeType);
            session.stop();
            recorderRef.current = null;
            recordSessionRef.current = null;
            recordChunksRef.current = [];
            recordingRef.current = false;
            recordingLockedRef.current = false;
            setRecording(false);
            setRecordingLocked(false);
            setShutterPressed(false);
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

    const clearKeyTimer = useCallback(() => {
        if (keyRef.current.timer) {
            clearTimeout(keyRef.current.timer);
            keyRef.current.timer = null;
        }
    }, []);

    const lockVideo = useCallback(() => {
        if (!recordingRef.current || recordingLockedRef.current) return false;
        clearPointerTimer();
        clearKeyTimer();
        recordingLockedRef.current = true;
        setRecordingLocked(true);
        setShutterPressed(false);
        return true;
    }, [clearKeyTimer, clearPointerTimer]);

    const handleShutterKeyDown = useCallback(
        (event) => {
            if (isLockKey(event)) {
                if (recordingRef.current && !recordingLockedRef.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    lockVideo();
                }
                return;
            }

            const key = shutterKeyValue(event);
            if (!key || event.metaKey || event.ctrlKey || event.altKey) return;
            event.preventDefault();
            event.stopPropagation();

            if (keyRef.current.active) {
                if (recordingRef.current && !recordingLockedRef.current && keyRef.current.key !== key) lockVideo();
                return;
            }

            if (recordingLockedRef.current) {
                if (!event.repeat) stopVideo();
                return;
            }

            if (captureRef.current) return;
            if (recordingRef.current) {
                lockVideo();
                return;
            }

            keyRef.current.active = true;
            keyRef.current.key = key;
            keyRef.current.long = false;
            setShutterPressed(true);
            clearKeyTimer();
            keyRef.current.timer = setTimeout(() => {
                keyRef.current.timer = null;
                keyRef.current.long = true;
                startVideo();
            }, VIDEO_HOLD_MS);
        },
        [clearKeyTimer, lockVideo, startVideo, stopVideo]
    );

    const handleShutterKeyUp = useCallback(
        (event) => {
            const key = shutterKeyValue(event);
            if (!key) return;
            event.preventDefault();
            event.stopPropagation();
            if (!keyRef.current.active) return;
            if (recordingLockedRef.current) {
                if (keyRef.current.key === key) {
                    keyRef.current.active = false;
                    keyRef.current.key = '';
                    keyRef.current.long = false;
                    setShutterPressed(false);
                    clearKeyTimer();
                }
                return;
            }
            const wasLong = keyRef.current.long;
            keyRef.current.active = false;
            keyRef.current.key = '';
            keyRef.current.long = false;
            setShutterPressed(false);
            clearKeyTimer();
            if (wasLong) {
                stopVideo();
                return;
            }
            takePhoto();
        },
        [clearKeyTimer, stopVideo, takePhoto]
    );

    const handleShutterKeyCancel = useCallback(() => {
        const wasLong = keyRef.current.long;
        keyRef.current.active = false;
        keyRef.current.key = '';
        keyRef.current.long = false;
        setShutterPressed(false);
        clearKeyTimer();
        if (wasLong && !recordingLockedRef.current) stopVideo();
    }, [clearKeyTimer, stopVideo]);

    useEffect(() => () => clearKeyTimer(), [clearKeyTimer]);

    const handleShutterDown = useCallback(
        (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (recordingLockedRef.current) {
                stopVideo();
                return;
            }
            if (captureRef.current || recordingRef.current) return;
            pointerRef.current.id = event.pointerId;
            pointerRef.current.long = false;
            pointerRef.current.startX = event.clientX;
            pointerRef.current.startY = event.clientY;
            setShutterPressed(true);
            event.currentTarget.setPointerCapture?.(event.pointerId);
            clearPointerTimer();
            pointerRef.current.timer = setTimeout(() => {
                pointerRef.current.timer = null;
                pointerRef.current.long = true;
                startVideo();
            }, VIDEO_HOLD_MS);
        },
        [clearPointerTimer, startVideo, stopVideo]
    );

    const handleShutterMove = useCallback(
        (event) => {
            if (pointerRef.current.id !== event.pointerId) return;
            if (!recordingRef.current || recordingLockedRef.current) return;
            if (event.pointerType !== 'touch' && event.buttons === 0) return;
            if (isHorizontalLockSlide(event, pointerRef.current)) lockVideo();
        },
        [lockVideo]
    );

    const handleShutterUp = useCallback(
        (event) => {
            const active = pointerRef.current.id === event.pointerId;
            if (!active) return;
            event.preventDefault();
            event.stopPropagation();
            const wasLong = pointerRef.current.long;
            const shouldLock = wasLong && recordingRef.current && !recordingLockedRef.current && isHorizontalLockSlide(event, pointerRef.current);
            if (shouldLock) lockVideo();
            const wasLocked = recordingLockedRef.current;
            pointerRef.current.id = null;
            pointerRef.current.long = false;
            setShutterPressed(false);
            clearPointerTimer();
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            if (wasLocked) return;
            if (wasLong) {
                stopVideo();
                return;
            }
            takePhoto();
        },
        [clearPointerTimer, lockVideo, stopVideo, takePhoto]
    );

    const handleShutterCancel = useCallback(
        (event) => {
            const active = pointerRef.current.id === event.pointerId;
            const wasLong = pointerRef.current.long;
            const shouldLock = active && wasLong && recordingRef.current && !recordingLockedRef.current && isHorizontalLockSlide(event, pointerRef.current);
            if (shouldLock) lockVideo();
            const wasLocked = recordingLockedRef.current;
            pointerRef.current.id = null;
            pointerRef.current.long = false;
            setShutterPressed(false);
            clearPointerTimer();
            if (active && !wasLocked) stopVideo();
        },
        [clearPointerTimer, lockVideo, stopVideo]
    );

    const clearInitialSendFocus = useCallback(() => {
        setInitialSendFocus(false);
    }, []);

    const handleCameraKeyDown = useCallback(
        (event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                handleShutterKeyCancel();
                focusFirstNavbarItem();
                return;
            }

            if (event.key !== 'Tab') return;
            event.preventDefault();
            event.stopPropagation();

            if (!captureRef.current) {
                focusShutter();
                return;
            }

            clearInitialSendFocus();
            const actions = actionRefs.current.filter(visibleFocusable);
            if (!actions.length) return;
            const current = actions.indexOf(document.activeElement);
            const offset = event.shiftKey ? -1 : 1;
            const next = current === -1 ? 0 : current + offset;
            actions[((next % actions.length) + actions.length) % actions.length]?.focus({ preventScroll: true });
        },
        [clearInitialSendFocus, focusShutter, handleShutterKeyCancel]
    );

    const focusShutterAfterPointer = useCallback(() => {
        window.setTimeout(() => {
            if (!captureRef.current) focusShutter();
        }, 0);
    }, [focusShutter]);

    const handleCameraPointer = useCallback(
        (event) => {
            if (captureRef.current) {
                clearInitialSendFocus();
                return;
            }
            if (event.button !== undefined && event.button !== 0) return;
            focusShutterAfterPointer();
        },
        [clearInitialSendFocus, focusShutterAfterPointer]
    );

    return (
        <div
            className="h-full relative overflow-hidden rounded-round"
            onClickCapture={handleCameraPointer}
            onPointerDownCapture={handleCameraPointer}
            onPointerUpCapture={handleCameraPointer}
            onKeyDown={handleCameraKeyDown}
        >
            <div className="absolute inset-0">
                <div className="absolute inset-0 -scale-x-100">
                    <Webcam
                        ref={webcamRef}
                        audio={false}
                        onUserMedia={focusShutter}
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
                        <button
                            ref={(node) => {
                                actionRefs.current[0] = node;
                            }}
                            type="button"
                            onClick={discardCapture}
                            className="backdrop-blur-sm size-12 rounded-full bg-background/70 grower cursor-pointer flex items-center justify-center"
                        >
                            <X className="size-5 text-foreground" />
                        </button>
                        <button
                            ref={(node) => {
                                actionRefs.current[1] = node;
                            }}
                            type="button"
                            onClick={handleSend}
                            data-initial-focus={initialSendFocus}
                            className="backdrop-blur-sm size-18 rounded-full bg-foreground/70 grower data-[initial-focus=true]:focus-visible:scale-100 cursor-pointer flex items-center justify-center"
                        >
                            <ArrowUpRight className="size-8 text-background" />
                        </button>
                        <button
                            ref={(node) => {
                                actionRefs.current[2] = node;
                            }}
                            type="button"
                            onClick={handleSave}
                            className="backdrop-blur-sm size-12 rounded-full bg-background/70 grower cursor-pointer flex items-center justify-center"
                        >
                            <Download className="size-5 text-foreground" />
                        </button>
                    </>
                ) : (
                    <button
                        ref={shutterRef}
                        type="button"
                        aria-label={recordingLocked ? 'stop recording' : recording ? 'recording video' : 'take photo'}
                        autoFocus
                        onPointerDown={handleShutterDown}
                        onPointerMove={handleShutterMove}
                        onPointerUp={handleShutterUp}
                        onPointerCancel={handleShutterCancel}
                        onLostPointerCapture={handleShutterCancel}
                        onKeyDown={handleShutterKeyDown}
                        onKeyUp={handleShutterKeyUp}
                        onBlur={handleShutterKeyCancel}
                        data-pressed={shutterPressed}
                        data-locked={recordingLocked}
                        className={`backdrop-blur-md size-18 rounded-full shadow cursor-pointer transition-transform hover:scale-120 active:scale-85 data-[pressed=true]:scale-85 data-[locked=true]:scale-90 flex items-center justify-center ${recording ? 'bg-destructive/75' : 'bg-background/70'}`}
                    >
                        {recordingLocked ? <Lock className="pointer-events-none size-6 text-foreground" strokeWidth={3} /> : null}
                    </button>
                )}
            </div>
        </div>
    );
}
