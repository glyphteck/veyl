'use client';

import { FUNDING_TX_PREVIEW_VBYTES, STATIC_DEPOSIT_CLAIM_FEE_SATS, formatOnchainFeeAmount, formatOnchainFeeFormula } from '@glyphteck/shared/wallet/fees';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useUser } from '@/components/providers/userprovider';

export default function FundingInfo({ data, close }) {
    const bitcoin = useBitcoin();
    const { openDialog } = useDialog();
    const { settings } = useUser();
    const estimate = bitcoin.estimateTransactionFees({
        speed: 'medium',
        vbytes: FUNDING_TX_PREVIEW_VBYTES,
        baseSats: STATIC_DEPOSIT_CLAIM_FEE_SATS,
    });
    const fee = estimate?.success ? estimate.onchainEstimate : null;
    const feeFormula = formatOnchainFeeFormula(fee, { vbytes: FUNDING_TX_PREVIEW_VBYTES, baseSats: STATIC_DEPOSIT_CLAIM_FEE_SATS, feeRatePrecision: 2 });
    const feeDisplay = formatOnchainFeeAmount(fee, settings?.moneyFormat || 'sats', bitcoin.price);

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
                        you can send bitcoin from any regular bitcoin wallet to your funding address to fund your veyl account. bitcoin transactions are not free. validators need to get paid.
                    </div>
                    <div className="text-sm font-black text-foreground">
                        {feeFormula} = {feeDisplay}
                    </div>
                    <div className="text-sm leading-6 font-bold text-muted">
                        the transaction fee is an estimate on how expensive it is to send bitcoin over the network at the moment, with an additional flat fee to import bitcoin onto the spark network.
                    </div>
                </div>
            </Card>
            <Button type="button" className="button-outline shrinker w-full" onClick={back}>
                back
            </Button>
        </div>
    );
}
