'use client';

import { COOPERATIVE_EXIT_FLAT_FEE_SATS, COOPERATIVE_EXIT_TX_VBYTES, formatOnchainFeeAmount, formatOnchainFeeFormula } from '@glyphteck/shared/wallet/fees';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useUser } from '@/components/providers/userprovider';

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
    const feeFormula = formatOnchainFeeFormula(fee, { vbytes: COOPERATIVE_EXIT_TX_VBYTES, baseSats: COOPERATIVE_EXIT_FLAT_FEE_SATS });
    const feeDisplay = formatOnchainFeeAmount(fee, settings?.moneyFormat || 'sats', bitcoin.price);
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
