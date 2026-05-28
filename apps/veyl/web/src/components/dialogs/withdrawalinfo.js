'use client';

import { COOPERATIVE_EXIT_FLAT_FEE_SATS, COOPERATIVE_EXIT_TX_VBYTES } from '@glyphteck/shared/wallet/fees';
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
    if (value == null) return 'updating';
    return `${formatWholeNumber(value)} ${value === 1 ? 'sat' : 'sats'}`;
}

function formatFeeRate(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate)) return 'updating';
    const rounded = Math.round(rate * 1000) / 1000;
    return `${rounded >= 10 ? formatWholeNumber(Math.round(rounded)) : String(rounded)} sat/vB`;
}

export default function WithdrawalInfo({ data, close }) {
    const bitcoin = useBitcoin();
    const { openDialog } = useDialog();
    const { settings } = useUser();
    const estimate = bitcoin.estimateTransactionFees({
        speed: 'medium',
        vbytes: COOPERATIVE_EXIT_TX_VBYTES,
        baseSats: COOPERATIVE_EXIT_FLAT_FEE_SATS,
    });
    const fee = estimate?.success ? estimate.onchainEstimate : null;
    const feeFormula = `${fee?.vbytes ?? COOPERATIVE_EXIT_TX_VBYTES} vB x ${formatFeeRate(fee?.feeRateSatsPerVbyte)} + ${formatSats(COOPERATIVE_EXIT_FLAT_FEE_SATS)}`;
    const feeAmount = Number(fee?.feeAmountSats);
    const feeDisplay = Number.isFinite(feeAmount) ? renderMoney(Math.max(0, Math.ceil(feeAmount)), settings?.moneyFormat || 'sats', bitcoin.price) : 'updating';
    const back = () => {
        if (data?.withdraw) {
            openDialog('withdraw', data.withdraw);
            return;
        }
        close();
    };

    return (
        <div className="flex w-lg max-w-[calc(100vw-2rem)] flex-col gap-2">
            <Card className="p-4">
                <div className="flex flex-col gap-3">
                    <div className="text-2xl font-black">about withdrawals</div>
                    <div className="text-sm leading-6 font-bold text-muted">
                        you can withdraw your funds back to any bitcoin address. bitcoin transactions are not free. validators need to get paid.
                    </div>
                    <div className="text-sm font-black text-foreground">
                        {feeFormula} = {feeDisplay}
                    </div>
                    <div className="text-sm leading-6 font-bold text-muted">
                        the transaction fee is an estimate on how expensive it is to send bitcoin over the network at the moment, with an additional flat fee to export bitcoin off the spark network.
                    </div>
                </div>
            </Card>
            <Button type="button" className="button-outline shrinker w-full" onClick={back}>
                back
            </Button>
        </div>
    );
}
