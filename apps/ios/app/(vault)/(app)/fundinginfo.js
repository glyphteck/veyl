import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { FUNDING_TX_PREVIEW_VBYTES, STATIC_DEPOSIT_CLAIM_FEE_SATS, formatOnchainFeeAmount, formatOnchainFeeFormula } from '@veyl/shared/wallet/fees';

import GlassButton from '@/components/glass/glassbutton';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';

export default function FundingInfoScreen() {
    const router = useRouter();
    const { theme } = useTheme();
    const { settings } = useUser();
    const bitcoin = useBitcoin();
    const estimate = bitcoin.estimateTransactionFees({
        speed: 'medium',
        vbytes: FUNDING_TX_PREVIEW_VBYTES,
        baseSats: STATIC_DEPOSIT_CLAIM_FEE_SATS,
    });
    const fee = estimate?.success ? estimate.onchainEstimate : null;
    const feeFormula = formatOnchainFeeFormula(fee, { vbytes: FUNDING_TX_PREVIEW_VBYTES, baseSats: STATIC_DEPOSIT_CLAIM_FEE_SATS, feeRatePrecision: 2 });
    const feeDisplay = formatOnchainFeeAmount(fee, settings?.moneyFormat || 'sats', bitcoin.price);

    return (
        <View style={{ backgroundColor: 'transparent', paddingHorizontal: 24, paddingTop: 24, gap: 14 }}>
            <Text style={{ fontSize: 32, fontWeight: '900', color: theme.foreground }}>about funding</Text>
            <Text style={{ fontSize: 15, lineHeight: 23, fontWeight: '700', color: theme.muted }}>
                you can send bitcoin from any regular bitcoin wallet to your funding address to fund your veyl account. bitcoin transactions are not free. validators need to get paid.
            </Text>
            <Text selectable style={{ fontSize: 14, fontWeight: '900', color: theme.foreground, fontVariant: ['tabular-nums'] }}>
                {feeFormula} = {feeDisplay}
            </Text>
            <Text style={{ fontSize: 15, lineHeight: 23, fontWeight: '700', color: theme.muted }}>
                the transaction fee is an estimate on how expensive it is to send bitcoin over the network at the moment, with an additional flat fee to import bitcoin onto the spark network.
            </Text>
            <GlassButton onPress={() => router.back()} label="back" accent />
        </View>
    );
}
