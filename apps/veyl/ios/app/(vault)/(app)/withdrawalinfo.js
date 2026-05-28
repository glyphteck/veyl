import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { COOPERATIVE_EXIT_FLAT_FEE_SATS, COOPERATIVE_EXIT_TX_VBYTES } from '@glyphteck/shared/wallet/fees';
import { renderMoney } from '@glyphteck/shared/utils';

import GlassButton from '@/components/glass/glassbutton';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';

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

export default function WithdrawalInfoScreen() {
    const router = useRouter();
    const { theme } = useTheme();
    const { settings } = useUser();
    const bitcoin = useBitcoin();
    const estimate = bitcoin.estimateTransactionFees({
        speed: 'medium',
        vbytes: COOPERATIVE_EXIT_TX_VBYTES,
        baseSats: COOPERATIVE_EXIT_FLAT_FEE_SATS,
    });
    const fee = estimate?.success ? estimate.onchainEstimate : null;
    const feeFormula = `${fee?.vbytes ?? COOPERATIVE_EXIT_TX_VBYTES} vB x ${formatFeeRate(fee?.feeRateSatsPerVbyte)} + ${formatSats(COOPERATIVE_EXIT_FLAT_FEE_SATS)}`;
    const feeAmount = Number(fee?.feeAmountSats);
    const feeDisplay = Number.isFinite(feeAmount) ? renderMoney(Math.max(0, Math.ceil(feeAmount)), settings?.moneyFormat || 'sats', bitcoin.price) : 'updating';

    return (
        <View style={{ backgroundColor: 'transparent', paddingHorizontal: 24, paddingTop: 24, gap: 14 }}>
            <Text style={{ fontSize: 32, fontWeight: '900', color: theme.foreground }}>about withdrawals</Text>
            <Text style={{ fontSize: 15, lineHeight: 23, fontWeight: '700', color: theme.muted }}>
                you can withdraw your funds back to any bitcoin address. bitcoin transactions are not free. validators need to get paid.
            </Text>
            <Text selectable style={{ fontSize: 14, fontWeight: '900', color: theme.foreground, fontVariant: ['tabular-nums'] }}>
                {feeFormula} = {feeDisplay}
            </Text>
            <Text style={{ fontSize: 15, lineHeight: 23, fontWeight: '700', color: theme.muted }}>
                the transaction fee is an estimate on how expensive it is to send bitcoin over the network at the moment, with an additional flat fee to export bitcoin off the spark network.
            </Text>
            <GlassButton onPress={() => router.back()} label="back" accent />
        </View>
    );
}
