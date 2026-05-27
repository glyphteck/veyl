import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { Check, CircleQuestionMark } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import { makeQr, qr } from '@glyphteck/shared/qrutils';
import { FUNDING_TX_PREVIEW_VBYTES, STATIC_DEPOSIT_CLAIM_FEE_SATS } from '@glyphteck/shared/wallet/fees';
import { renderMoney } from '@glyphteck/shared/utils';

import Icon from '@/components/icon';
import { usePop } from '@/lib/pop';
import { useTap } from '@/lib/tap';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';

function formatFeeAmount(value, moneyFormat, price) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 'updating';
    return renderMoney(Math.max(0, Math.ceil(amount)), moneyFormat || 'sats', price);
}

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
    const routeLockRef = useRef(false);
    const routeLockTimerRef = useRef(null);

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
    const lockRoute = useCallback((ms = 1200) => {
        if (routeLockRef.current) return false;
        routeLockRef.current = true;
        if (routeLockTimerRef.current) clearTimeout(routeLockTimerRef.current);
        routeLockTimerRef.current = setTimeout(() => {
            routeLockRef.current = false;
            routeLockTimerRef.current = null;
        }, ms);
        return true;
    }, []);
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

    useEffect(
        () => () => {
            if (routeLockTimerRef.current) {
                clearTimeout(routeLockTimerRef.current);
            }
        },
        []
    );

    if (loading || !qrValue) return null;

    return (
        <View style={{ position: 'relative', alignItems: 'center', paddingHorizontal: 48, paddingTop: 24 }}>
            <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingBottom: 6 }}>
                <Text numberOfLines={1} style={{ flex: 1, color: theme.foreground, fontSize: 16, fontWeight: '900' }}>
                    estimated fee: ~{formatFeeAmount(fundingFeePreview?.feeAmountSats, settings?.moneyFormat, bitcoin.price)}
                </Text>
                <Pressable {...feeHelpTap.props} accessibilityRole="button" accessibilityLabel="funding fee info" hitSlop={8}>
                    <Animated.View style={{ transform: [{ scale: feeHelpTap.scale }] }}>
                        <Icon icon={CircleQuestionMark} size={28} color={theme.foreground} />
                    </Animated.View>
                </Pressable>
            </View>
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
