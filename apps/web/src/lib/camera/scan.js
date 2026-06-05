import { useCallback, useEffect, useRef } from 'react';
import { Coins, Loader } from 'lucide-react';
import { toast } from 'sonner';
import { isAddressOnNetwork } from '@veyl/shared/network';
import { renderMoney } from '@veyl/shared/money';
import { formatUserDisplay } from '@veyl/shared/profile';
import { qr, readQr } from '@veyl/shared/qr';
import { canSendOnScan } from '@veyl/shared/settings';

const SCAN_INTERVAL = 200;

export function useScan({ addPeer, bitcoin, capture, cloaked, network, onUser, openDialog, recording, sendMoneyWithSpark, settings, username, walletPK, webcamRef }) {
    const detectorRef = useRef(null);
    const scanTimer = useRef(null);
    const busyRef = useRef(false);

    const handleQr = useCallback(
        async (rawValue) => {
            if (!rawValue || busyRef.current) return;
            busyRef.current = true;
            try {
                const qrData = readQr(rawValue.trim());

                if (qrData?.kind === qr.user && qrData.username) {
                    if (qrData.username === username) return;
                    if (onUser) {
                        await onUser(qrData.username);
                        return;
                    }
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

                    if (canSendOnScan(settings) && qrData.amount) {
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
                            toast.error(error?.message || 'failed to send money', {
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
                }
            } catch (err) {
                console.error('QR handling failed:', err);
            } finally {
                setTimeout(() => {
                    busyRef.current = false;
                }, 1000);
            }
        },
        [addPeer, bitcoin, cloaked, network, onUser, openDialog, sendMoneyWithSpark, settings, username, walletPK]
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
    }, [capture, handleQr, recording, webcamRef]);
}
