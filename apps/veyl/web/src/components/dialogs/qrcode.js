'use client';
import { useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { makeQr, qr } from '@glyphteck/shared/qrutils';
import { FUNDING_TX_PREVIEW_VBYTES, STATIC_DEPOSIT_CLAIM_FEE_SATS } from '@glyphteck/shared/wallet/fees';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useUser } from '@/components/providers/userprovider';
import { renderMoney } from '@/lib/utils';
import { CircleQuestionMark } from 'lucide-react';

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
    const body =
        isBitcoinQr
            ? 'send bitcoin to this address to fund your account. this is a normal bitcoin transaction. it will take around 30 minutes to confirm, and you will pay fees on it.'
            : data?.type === qr.user
              ? 'share your account to receive money or connect with people faster.'
              : '';

    if (!qrValue) return null;

    return (
        <div className="flex flex-col items-center gap-4">
            {isUserQr ? (
                <div className="flex items-center gap-3">
                    <Avatar active={!!active} className="size-14">
                        <AvatarImage src={avatar} alt={title} />
                        <AvatarFallback />
                    </Avatar>
                    <p className="text-3xl font-black">{title}</p>
                </div>
            ) : null}
            <QRCodeSVG value={qrValue} bgColor="transparent" fgColor="oklch(0 0 0)" className="dark:invert size-85" />
            {isBitcoinQr ? (
                <div className="flex w-full max-w-lg items-center justify-between gap-3">
                    <div className="w-fit max-w-full rounded-full bg-background/70 px-4 py-2 text-sm font-black shadow backdrop-blur-sm">
                        <div className="truncate whitespace-nowrap">estimated fee: ~{formatFeeAmount(fundingFeePreview?.feeAmountSats, settings?.moneyFormat, bitcoin.price)}</div>
                    </div>
                    <Button type="button" className="grower-lg text-foreground" onClick={() => openDialog('fundinginfo', { fundingQr: data })} title="funding fee info">
                        <CircleQuestionMark />
                    </Button>
                </div>
            ) : body ? (
                <Card className="w-full max-w-lg p-4">
                    <p className="text-center font-black text-lg">{body}</p>
                </Card>
            ) : null}
        </div>
    );
}
