'use client';

import { FUNDING_TX_PREVIEW_VBYTES, STATIC_DEPOSIT_FEE_ESTIMATE_SATS } from '@glyphteck/shared/walletfees';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useUser } from '@/components/providers/userprovider';
import { renderMoney } from '@/lib/utils';

function formatWholeNumber(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatSats(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 'updating';
    const sats = Math.max(0, Math.ceil(amount));
    return `${formatWholeNumber(sats)} ${sats === 1 ? 'sat' : 'sats'}`;
}

function formatFeeRate(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate)) return 'updating';
    const formatted = rate >= 10 ? formatWholeNumber(Math.round(rate)) : String(Math.round(rate * 100) / 100);
    return `${formatted} sat/vB`;
}

export default function FundingInfo({ data, close }) {
    const bitcoin = useBitcoin();
    const { openDialog } = useDialog();
    const { settings } = useUser();
    const estimate = bitcoin.estimateTransactionFees({
        speed: 'medium',
        vbytes: FUNDING_TX_PREVIEW_VBYTES,
        baseSats: STATIC_DEPOSIT_FEE_ESTIMATE_SATS,
    });
    const fee = estimate?.success ? estimate.onchainEstimate : null;
    const feeFormula = `${formatFeeRate(fee?.feeRateSatsPerVbyte)} x ${fee?.vbytes ?? FUNDING_TX_PREVIEW_VBYTES} vB + ${formatSats(STATIC_DEPOSIT_FEE_ESTIMATE_SATS)}`;
    const feeAmount = Number(fee?.feeAmountSats);
    const feeDisplay = Number.isFinite(feeAmount) ? renderMoney(Math.max(0, Math.ceil(feeAmount)), settings?.moneyFormat || 'sats', bitcoin.price) : 'updating';

    const back = () => {
        if (data?.fundingQr) {
            openDialog('qrcode', data.fundingQr);
            return;
        }
        close();
    };

    return (
        <div className="flex w-lg max-w-[calc(100vw-2rem)] flex-col gap-2">
            <Card className="p-4">
                <div className="flex flex-col gap-3">
                    <div className="text-2xl font-black">about funding</div>
                    <div className="text-sm leading-6 font-bold text-muted">
                        you can send bitcoin from any regular bitcoin wallet to your funding address to fund your veyl account. bitcoin transactions are not free. in order to be validated, they need a network fee.
                    </div>
                    <div className="text-sm font-black text-foreground">
                        {feeFormula} = {feeDisplay}
                    </div>
                    <div className="text-sm leading-6 font-bold text-muted">
                        the transaction fee is an estimate on how expensive it is to send a transaction on the bitcoin blockchain at the moment, with an added flat fee to import bitcoin onto the spark chain.
                    </div>
                </div>
            </Card>
            <Button type="button" className="button-outline shrinker w-full" onClick={back}>
                ok
            </Button>
        </div>
    );
}
