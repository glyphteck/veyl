'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
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

const SCAN_INTERVAL = 200;

export default function CameraPage() {
    const webcamRef = useRef(null);
    const detectorRef = useRef(null);
    const scanTimer = useRef(null);
    const busyRef = useRef(false);
    const { openDialog } = useDialog();
    const { addPeer } = usePeer();
    const { settings, username, walletPK } = useUser();
    const { sendMoneyWithSpark, bitcoin, network } = useWallet();
    const { cloaked } = useCloak();
    const [photo, setPhoto] = useState(null);

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
        if (photo) return;
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
    }, [handleQr, photo]);

    const takePhoto = useCallback(() => {
        const src = webcamRef.current?.getScreenshot();
        if (src) setPhoto(src);
    }, []);

    const discardPhoto = useCallback(() => {
        setPhoto(null);
    }, []);

    const handleSend = useCallback(() => {
        if (!photo) return;
        openDialog('sendphoto', { photo, onSent: () => setPhoto(null) });
    }, [openDialog, photo]);

    const handleSave = useCallback(() => {
        if (!photo) return;
        const a = document.createElement('a');
        a.href = photo;
        a.download = `veyl-${Date.now()}.jpg`;
        a.click();
    }, [photo]);

    return (
        <div className="h-full relative overflow-hidden rounded-round">
            <div className="absolute inset-0 -scale-x-100">
                <Webcam
                    ref={webcamRef}
                    audio={false}
                    screenshotFormat="image/jpeg"
                    videoConstraints={{ facingMode: 'environment' }}
                    className={`absolute inset-0 w-full h-full object-cover transition-all duration-300 ${cloaked ? 'blur-3xl scale-110' : ''}`}
                />
                {photo && <img src={photo} alt="preview" className="absolute inset-0 w-full h-full object-cover" />}
            </div>
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-8">
                {photo ? (
                    <>
                        <button onClick={discardPhoto} className="backdrop-blur-sm size-12 rounded-full bg-background/70 grower cursor-pointer flex items-center justify-center">
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
                    <div onClick={takePhoto} className="backdrop-blur-md size-18 rounded-full shadow bg-background/70 grower cursor-pointer" />
                )}
            </div>
        </div>
    );
}
