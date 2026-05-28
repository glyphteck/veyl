'use client';
import { useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { makeQr, qr } from '@glyphteck/shared/qrutils';
import { FUNDING_TX_PREVIEW_VBYTES, STATIC_DEPOSIT_CLAIM_FEE_SATS } from '@glyphteck/shared/wallet/fees';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { Button } from '@/components/button';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useUser } from '@/components/providers/userprovider';
import { renderMoney } from '@/lib/utils';

function formatFeeAmount(value, moneyFormat, price) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 'updating';
    return renderMoney(Math.max(0, Math.ceil(amount)), moneyFormat || 'sats', price);
}

export default function QRCodeDialog({ data }) {
    const { avatar, username, active, settings } = useUser();
    const { openDialog } = useDialog();
    const bitcoin = useBitcoin();
    const qrValue = makeQr(data);
    const isUserQr = data?.type === qr.user;
    const isBitcoinQr = data?.type === qr.bitcoin;
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
                        <span className="min-w-0 truncate whitespace-nowrap">estimated fee: ~{formatFeeAmount(fundingFeePreview?.feeAmountSats, settings?.moneyFormat, bitcoin.price)}</span>
                    </Button>
                </div>
            ) : null}
            <QRCodeSVG value={qrValue} bgColor="transparent" fgColor="oklch(0 0 0)" className="dark:invert size-85" />
        </div>
    );
}
