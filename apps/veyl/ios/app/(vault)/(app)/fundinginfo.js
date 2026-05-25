import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { FUNDING_TX_PREVIEW_VBYTES, STATIC_DEPOSIT_FEE_ESTIMATE_SATS } from '@glyphteck/shared/walletfees';
import { renderMoney } from '@glyphteck/shared/utils';

import GlassButton from '@/components/glass/glassbutton';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';

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

export default function FundingInfoScreen() {
    const router = useRouter();
    const { theme } = useTheme();
    const { settings } = useUser();
    const bitcoin = useBitcoin();
    const estimate = bitcoin.estimateTransactionFees({
        speed: 'medium',
        vbytes: FUNDING_TX_PREVIEW_VBYTES,
        baseSats: STATIC_DEPOSIT_FEE_ESTIMATE_SATS,
    });
    const fee = estimate?.success ? estimate.onchainEstimate : null;
    const feeFormula = `${formatFeeRate(fee?.feeRateSatsPerVbyte)} x ${fee?.vbytes ?? FUNDING_TX_PREVIEW_VBYTES} vB + ${formatSats(STATIC_DEPOSIT_FEE_ESTIMATE_SATS)}`;
    const feeAmount = Number(fee?.feeAmountSats);
    const feeDisplay = Number.isFinite(feeAmount) ? renderMoney(Math.max(0, Math.ceil(feeAmount)), settings?.moneyFormat || 'sats', bitcoin.price) : 'updating';

    return (
        <View style={{ backgroundColor: 'transparent', paddingHorizontal: 24, paddingTop: 24, gap: 14 }}>
            <Text style={{ fontSize: 32, fontWeight: '900', color: theme.foreground }}>about funding</Text>
            <Text style={{ fontSize: 15, lineHeight: 23, fontWeight: '700', color: theme.muted }}>
                you can send bitcoin from any regular bitcoin wallet to your funding address to fund your veyl account. bitcoin transactions are not free. in order to be validated, they need a network fee.
            </Text>
            <Text selectable style={{ fontSize: 14, fontWeight: '900', color: theme.foreground, fontVariant: ['tabular-nums'] }}>
                {feeFormula} = {feeDisplay}
            </Text>
            <Text style={{ fontSize: 15, lineHeight: 23, fontWeight: '700', color: theme.muted }}>
                the transaction fee is an estimate on how expensive it is to send a transaction on the bitcoin blockchain at the moment, with an added flat fee to import bitcoin onto the spark chain.
            </Text>
            <GlassButton onPress={() => router.back()} label="ok" accent />
        </View>
    );
}
