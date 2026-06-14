'use client';
import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { makeLightningInvoiceQr, makeQr, qr } from '@veyl/shared/qr';
import { FUNDING_TX_PREVIEW_VBYTES, STATIC_DEPOSIT_CLAIM_FEE_SATS, formatOnchainFeeAmount } from '@veyl/shared/wallet/fees';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { Button } from '@/components/button';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useUser } from '@/components/providers/userprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { Zap } from 'lucide-react';
import { isLightningReceiveDone, isReceivePaymentTransfer } from '@veyl/shared/wallet/tx';
import styles from './qrcode.module.css';

const RECEIVE_POLL_MS = 2500;

export default function QRCodeDialog({ data, close }) {
    const { avatar, username, active, settings } = useUser();
    const { openDialog } = useDialog();
    const { copyFundingAddress, getLightningReceiveRequest, refresh, transfers } = useWallet();
    const bitcoin = useBitcoin();
    const isUserQr = data?.type === qr.user;
    const isBitcoinQr = data?.type === qr.bitcoin;
    const isLightningQr = data?.type === qr.lightning;
    const [lightningMode, setLightningMode] = useState(false);
    const [paid, setPaid] = useState(false);
    const [shownAt, setShownAt] = useState(() => Date.now());
    const qrValue = isLightningQr && lightningMode ? makeLightningInvoiceQr(data?.value) : makeQr(data);
    const invoiceId = isLightningQr ? data?.value?.id : null;
    const invoiceAmountSats = isLightningQr ? data?.value?.amountSats : null;
    const qrIdentity = typeof data?.value === 'string' ? data.value : data?.value?.id || data?.value?.encodedInvoice || '';
    const canCopyQr = (isBitcoinQr || (isLightningQr && lightningMode)) && !paid;
    const hasReceiveTransfer = useMemo(() => {
        if (!isLightningQr || !qrIdentity) return false;
        return Array.isArray(transfers) && transfers.some((tx) => isReceivePaymentTransfer(tx, { createdAt: shownAt, amountSats: invoiceAmountSats }));
    }, [invoiceAmountSats, isLightningQr, qrIdentity, shownAt, transfers]);

    useEffect(() => {
        setLightningMode(false);
        setPaid(false);
        setShownAt(Date.now());
    }, [data?.type, qrIdentity]);

    useEffect(() => {
        if (!isLightningQr || !invoiceId) return undefined;

        let cancelled = false;
        let timer = null;
        const poll = async () => {
            const result = await getLightningReceiveRequest(invoiceId);
            if (cancelled) return;
            if (result?.success && isLightningReceiveDone(result.invoice?.status)) {
                setPaid(true);
                await refresh?.();
                return;
            }
            timer = window.setTimeout(poll, RECEIVE_POLL_MS);
        };

        void poll().catch(() => {
            if (!cancelled) timer = window.setTimeout(poll, RECEIVE_POLL_MS);
        });

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [getLightningReceiveRequest, invoiceId, isLightningQr, refresh]);

    useEffect(() => {
        if (paid || !hasReceiveTransfer) return;
        setPaid(true);
        void refresh?.();
    }, [hasReceiveTransfer, paid, refresh]);

    const fundingFeePreview = useMemo(() => {
        if (!isBitcoinQr) return null;
        const estimate = bitcoin.estimateTransactionFees({
            speed: 'medium',
            vbytes: FUNDING_TX_PREVIEW_VBYTES,
            baseSats: STATIC_DEPOSIT_CLAIM_FEE_SATS,
        });
        return estimate?.success ? estimate.onchainEstimate : null;
    }, [bitcoin, isBitcoinQr]);
    const title = username ? `@${username}` : 'share your veyl';
    if (!qrValue) return null;

    const copyQr = () => {
        if (!canCopyQr) return;
        if (isBitcoinQr) {
            void copyFundingAddress?.(data?.value).catch(() => {});
            return;
        }
        void navigator.clipboard.writeText(qrValue).catch(() => {});
    };

    const qrClassName = `${styles.qr} ${paid ? styles.paid : ''}`;
    const qrCode = <QRCodeSVG value={qrValue} bgColor="transparent" fgColor="currentColor" className="size-85" />;
    const closeOnPaidAnimationEnd = () => {
        if (paid) close?.();
    };

    return (
        <div className={`flex flex-col items-center ${isBitcoinQr ? 'gap-1' : 'gap-4'}`}>
            {isUserQr ? (
                <div className="flex items-center gap-3">
                    <Avatar active={!!active} className="size-14">
                        <AvatarImage src={avatar} alt={title} />
                        <AvatarFallback />
                    </Avatar>
                    <p className="text-3xl font-black">{title}</p>
                </div>
            ) : null}
            {isBitcoinQr ? (
                <div className="flex w-full max-w-lg justify-start">
                    <Button
                        type="button"
                        className="grower-sm min-w-0 max-w-full justify-start p-0 text-base font-black text-foreground"
                        onClick={() => openDialog('fundinginfo', { fundingQr: data })}
                        title="funding fee info"
                    >
                        <span className="min-w-0 truncate whitespace-nowrap">estimated fee: ~{formatOnchainFeeAmount(fundingFeePreview, settings?.moneyFormat, bitcoin.price)}</span>
                    </Button>
                </div>
            ) : null}
            {isLightningQr ? (
                <div className="flex w-full max-w-lg justify-start">
                    <Button type="button" className={`size-11 shrink-0 ${lightningMode ? 'button-fill' : 'button-outline'}`} onClick={() => setLightningMode((current) => !current)} title={lightningMode ? 'show veyl qr' : 'show lightning invoice'}>
                        <Zap className="size-5" />
                    </Button>
                </div>
            ) : null}
            {canCopyQr ? (
                <button type="button" className={`${qrClassName} cursor-pointer border-0 bg-transparent p-0`} onAnimationEnd={closeOnPaidAnimationEnd} onClick={copyQr} title={isBitcoinQr ? 'copy funding address' : 'copy lightning invoice'}>
                    {qrCode}
                </button>
            ) : (
                <span className={qrClassName} onAnimationEnd={closeOnPaidAnimationEnd}>
                    {qrCode}
                </span>
            )}
        </div>
    );
}
