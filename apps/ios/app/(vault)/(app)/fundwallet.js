import { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useIsFocused, useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import { makeQr, qr } from '@veyl/shared/qr';
import { FUNDING_TX_PREVIEW_VBYTES, STATIC_DEPOSIT_CLAIM_FEE_SATS, formatOnchainFeeAmount } from '@veyl/shared/wallet/fees';

import Icon from '@/components/icon';
import { usePop } from '@/lib/pop';
import { useRouteLock } from '@/lib/navigation/routelock';
import { useTap } from '@/lib/tap';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';

export default function FundWalletScreen() {
    const { theme } = useTheme();
    const router = useRouter();
    const isFocused = useIsFocused();
    const { settings } = useUser();
    const bitcoin = useBitcoin();
    const { fundingAddress, getFundingAddress } = useWallet();
    const [address, setAddress] = useState(fundingAddress);
    const [loading, setLoading] = useState(!fundingAddress);
    const [copied, setCopied] = useState(false);
    const [qrSize, setQrSize] = useState(0);
    const { lockRoute } = useRouteLock();

    useEffect(() => {
        if (isFocused) {
            setCopied(false);
        }
    }, [isFocused]);

    useEffect(() => {
        let cancelled = false;

        if (fundingAddress) {
            setAddress(fundingAddress);
            setLoading(false);

            return () => {
                cancelled = true;
            };
        }

        setAddress(null);
        setLoading(true);

        getFundingAddress?.()
            .then((addr) => {
                if (cancelled) return;
                setAddress(addr || null);
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                setAddress(null);
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [fundingAddress, getFundingAddress]);

    useEffect(() => {
        if (!address) return;
        void Clipboard.setStringAsync(address).catch(() => {});
    }, [address]);

    const qrValue = useMemo(() => {
        if (!address) return null;
        return makeQr({ type: qr.bitcoin, value: address });
    }, [address]);

    const fundingFeePreview = useMemo(() => {
        const estimate = bitcoin.estimateTransactionFees({
            speed: 'medium',
            vbytes: FUNDING_TX_PREVIEW_VBYTES,
            baseSats: STATIC_DEPOSIT_CLAIM_FEE_SATS,
        });
        return estimate?.success ? estimate.onchainEstimate : null;
    }, [bitcoin]);

    const copyAddress = () => {
        if (!address) return;
        void Clipboard.setStringAsync(address)
            .then(() => setCopied(true))
            .catch(() => {});
    };
    const openFundingInfo = useCallback(() => {
        if (!lockRoute()) return;
        router.push('/fundinginfo');
    }, [lockRoute, router]);
    const qrCopyTap = useTap({ scale: 0.96, onPress: copyAddress });
    const feeHelpTap = useTap({ onPress: openFundingInfo });
    const copiedPop = usePop({ show: copied });
    const updateQrSize = (event) => {
        const width = Math.floor(event.nativeEvent.layout.width);
        if (width > 0 && width !== qrSize) {
            setQrSize(width);
        }
    };

    if (loading || !qrValue) return null;

    return (
        <View style={{ position: 'relative', alignItems: 'center', paddingHorizontal: 48, paddingTop: 24 }}>
            <Pressable {...feeHelpTap.props} accessibilityRole="button" accessibilityLabel="funding fee info" hitSlop={8} style={{ alignSelf: 'stretch', paddingBottom: 4 }}>
                <Animated.View style={{ alignSelf: 'flex-start', maxWidth: '100%', transform: [{ scale: feeHelpTap.scale }] }}>
                    <Text numberOfLines={1} style={{ color: theme.foreground, fontSize: 17, fontWeight: '900' }}>
                        estimated fee: ~{formatOnchainFeeAmount(fundingFeePreview, settings?.moneyFormat, bitcoin.price)}
                    </Text>
                </Animated.View>
            </Pressable>
            <View style={{ alignSelf: 'stretch', alignItems: 'center' }} onLayout={updateQrSize}>
                <Pressable accessibilityRole="button" accessibilityLabel="copy funding address" {...qrCopyTap.props}>
                    <Animated.View style={{ transform: [{ scale: qrCopyTap.scale }] }}>
                        {qrSize > 0 ? <QRCode value={qrValue} size={qrSize} backgroundColor="transparent" color={theme.foreground} /> : null}
                    </Animated.View>
                </Pressable>
            </View>
            <View style={{ paddingTop: 12, alignItems: 'center', justifyContent: 'center' }}>
                <Animated.View pointerEvents={copiedPop.pointerEvents} style={[{ flexDirection: 'row', alignItems: 'center', gap: 6 }, copiedPop.childStyle]}>
                    <Icon icon={Check} size={15} color={theme.muted} />
                    <Text style={{ color: theme.muted, fontSize: 13, fontWeight: '900' }}>address copied</Text>
                </Animated.View>
            </View>
        </View>
    );
}
