'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CameraActions } from '@/components/camera/actions';
import { CameraShutter } from '@/components/camera/shutter';
import { CameraStage } from '@/components/camera/stage';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useUser } from '@/components/providers/userprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useRecord } from '@/lib/camera/record';
import { useScan } from '@/lib/camera/scan';
import { downloadCapture, stagePhotoCapture } from '@/lib/camera/staging';
import { useCloak } from '@veyl/shared/providers/cloakprovider';

const NAV_FOCUSABLE_SELECTOR = 'nav button:not(:disabled), nav [href], nav input:not(:disabled), nav select:not(:disabled), nav textarea:not(:disabled), nav [tabindex]:not([tabindex="-1"])';

function visibleFocusable(element) {
    return !!element && element.tabIndex >= 0 && !element.disabled && element.getClientRects().length > 0;
}

function focusFirstNavbarItem() {
    const item = [...(document.querySelectorAll?.(NAV_FOCUSABLE_SELECTOR) || [])].find(visibleFocusable);
    item?.focus?.({ preventScroll: true });
}

export default function CameraPage() {
    const webcamRef = useRef(null);
    const shutterRef = useRef(null);
    const actionRefs = useRef([]);
    const captureRef = useRef(null);
    const { openDialog } = useDialog();
    const { addPeer } = usePeer();
    const { settings, username, walletPK } = useUser();
    const bitcoin = useBitcoin();
    const { sendMoneyWithSpark, network } = useWallet();
    const { cloaked } = useCloak();
    const [capture, setCapture] = useState(null);
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

    const takePhoto = useCallback(async () => {
        const staged = await stagePhotoCapture(webcamRef.current?.getScreenshot());
        if (staged) setCapture(staged);
    }, []);

    const {
        handleShutterCancel,
        handleShutterDown,
        handleShutterKeyCancel,
        handleShutterKeyDown,
        handleShutterKeyUp,
        handleShutterMove,
        handleShutterUp,
        recording,
        recordingLocked,
        shutterPressed,
    } = useRecord({
        captureRef,
        onPhoto: takePhoto,
        setCapture,
        webcamRef,
    });

    useScan({
        addPeer,
        bitcoin,
        capture,
        cloaked,
        network,
        openDialog,
        recording,
        sendMoneyWithSpark,
        settings,
        username,
        walletPK,
        webcamRef,
    });

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
        downloadCapture(capture);
    }, [capture]);

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
            <CameraStage capture={capture} cloaked={cloaked} onUserMedia={focusShutter} webcamRef={webcamRef} />
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-8">
                {capture ? (
                    <CameraActions actionRefs={actionRefs} initialSendFocus={initialSendFocus} onDiscard={discardCapture} onSave={handleSave} onSend={handleSend} />
                ) : (
                    <CameraShutter
                        ref={shutterRef}
                        onBlur={handleShutterKeyCancel}
                        onKeyDown={handleShutterKeyDown}
                        onKeyUp={handleShutterKeyUp}
                        onLostPointerCapture={handleShutterCancel}
                        onPointerCancel={handleShutterCancel}
                        onPointerDown={handleShutterDown}
                        onPointerMove={handleShutterMove}
                        onPointerUp={handleShutterUp}
                        pressed={shutterPressed}
                        recording={recording}
                        recordingLocked={recordingLocked}
                    />
                )}
            </div>
        </div>
    );
}
