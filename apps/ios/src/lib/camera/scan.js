import { useCallback, useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useBarcodeScannerOutput } from 'react-native-vision-camera-barcode-scanner';
import { isAddressOnNetwork } from '@veyl/shared/network';
import { qr, readQr } from '@veyl/shared/qr';
import { canSendOnScan } from '@veyl/shared/settings';
import { mark } from '@/lib/diagnostics';

const QR_BARCODE_FORMATS = ['qr-code'];
const SCAN_COOLDOWN = 700;

export function useScan({ addPeer, hidePreview, holdPreview, lockRoute, network, onUser, open, ownWalletPK, pageOpen, previewRef, recordingRef, routeLockedRef, settings }) {
    const scanRef = useRef({
        raw: '',
        time: 0,
        busy: false,
    });

    const reset = useCallback(() => {
        scanRef.current.raw = '';
        scanRef.current.time = 0;
        scanRef.current.busy = false;
    }, []);

    useEffect(() => {
        if (open) return;
        scanRef.current.busy = false;
    }, [open]);

    useEffect(() => {
        if (pageOpen) return;
        reset();
    }, [pageOpen, reset]);

    const scan = useCallback(
        async (data) => {
            if (!open || recordingRef.current || !data) return;
            const raw = data.trim();
            if (!raw) return;

            const now = Date.now();
            const last = scanRef.current;
            if (last.busy) return;

            const qrData = readQr(raw);

            if (qrData?.kind === qr.user && qrData.username) {
                const key = `user:${qrData.username}`;
                if (previewRef.current.key === key) {
                    holdPreview(key);
                    last.raw = raw;
                    last.time = now;
                    return;
                }

                if (now - last.time < SCAN_COOLDOWN) return;

                last.raw = raw;
                last.time = now;
                last.busy = true;

                try {
                    await onUser(qrData.username);
                } finally {
                    last.busy = false;
                }
                return;
            }

            if (now - last.time < SCAN_COOLDOWN) return;

            last.raw = raw;
            last.time = now;
            last.busy = true;

            try {
                if (previewRef.current.loading || routeLockedRef.current) return;

                if (qrData?.kind === qr.request && qrData.to === ownWalletPK) {
                    return;
                }

                if (qrData?.kind === qr.request && qrData.to) {
                    hidePreview();
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    if (!lockRoute()) return;

                    const auto = canSendOnScan(settings) && !!qrData.amount;
                    if (qrData.amount) {
                        router.navigate({
                            pathname: '/transfer',
                            params: {
                                walletPK: qrData.to,
                                amount: qrData.amount,
                                send: '1',
                                auto: auto ? '1' : '0',
                            },
                        });
                    } else {
                        let peer = null;
                        try {
                            peer = await addPeer?.({ walletPK: qrData.to });
                        } catch (error) {
                            console.warn('peer lookup failed', error);
                        }
                        router.navigate({
                            pathname: '/transfer',
                            params: {
                                uid: peer?.uid ?? '',
                                walletPK: peer?.walletPK ?? qrData.to,
                                send: '1',
                            },
                        });
                    }
                    return;
                }

                if (qrData?.kind === qr.bitcoin && qrData.address) {
                    if (!isAddressOnNetwork(qrData.address, network)) {
                        console.warn(`ignoring wrong-network bitcoin qr (active: ${network})`);
                        return;
                    }
                    hidePreview();
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    if (!lockRoute()) return;
                    router.navigate({ pathname: '/withdraw', params: { address: qrData.address } });
                    return;
                }
            } finally {
                scanRef.current.busy = false;
            }
        },
        [addPeer, hidePreview, holdPreview, lockRoute, network, onUser, open, ownWalletPK, previewRef, recordingRef, routeLockedRef, settings]
    );

    const output = useBarcodeScannerOutput({
        barcodeFormats: QR_BARCODE_FORMATS,
        outputResolution: 'preview',
        onBarcodeScanned: (barcodes) => {
            if (recordingRef.current) return;
            const barcode = barcodes[0];
            if (barcode) scan(barcode.rawValue ?? barcode.displayValue ?? '');
        },
        onError: (error) => {
            mark('camera.scan.error', { message: error?.message || String(error) });
            console.warn('qr scan failed', error);
        },
    });

    return { output, reset };
}
