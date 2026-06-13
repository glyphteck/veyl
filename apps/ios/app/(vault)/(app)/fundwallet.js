import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useIsFocused } from 'expo-router';
import { RefreshCw, Zap } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import { BTC_PRICE_FALLBACK } from '@veyl/shared/config';
import { MONEY_UNITS, toDisplay, toSats } from '@veyl/shared/money';
import { makeLightningInvoiceQr, makeQr, qr } from '@veyl/shared/qr';
import { isLightningReceiveDone, isReceivePaymentTransfer } from '@veyl/shared/wallet/tx';

import AmountInput from '@/components/amountinput';
import GlassButton from '@/components/glass/glassbutton';
import GlassField from '@/components/glass/glassfield';
import GlassIcon from '@/components/glass/glassicon';
import Icon from '@/components/icon';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';

const RECEIVE_POLL_MS = 2500;
const RECEIVE_PAID_MS = 650;
const RECEIVE_PAID_SHRINK_MS = Math.round(RECEIVE_PAID_MS * 0.45);
const RECEIVE_PAID_GROW_MS = RECEIVE_PAID_MS - RECEIVE_PAID_SHRINK_MS;

export default function FundWalletScreen() {
    const { theme, isDark } = useTheme();
    const isFocused = useIsFocused();
    const { settings, username, walletPK } = useUser();
    const bitcoin = useBitcoin();
    const { createLightningInvoice, getLightningReceiveRequest, refresh, transfers } = useWallet();
    const [invoice, setInvoice] = useState(null);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');
    const [amount, setAmount] = useState('');
    const [unit, setUnit] = useState(settings?.moneyFormat || 'sats');
    const [lightningMode, setLightningMode] = useState(false);
    const [paid, setPaid] = useState(false);
    const [shownAt, setShownAt] = useState(() => Date.now());
    const [qrSize, setQrSize] = useState(0);
    const paidScale = useRef(new Animated.Value(1)).current;
    const price = bitcoin?.price ?? BTC_PRICE_FALLBACK;

    const amountSats = useMemo(() => {
        if (!amount) return 0n;
        try {
            const sats = toSats(amount, unit, price);
            return sats > 0n ? sats : 0n;
        } catch {
            return 0n;
        }
    }, [amount, price, unit]);

    const invoiceValue = invoice?.encodedInvoice || null;
    const qrValue = useMemo(() => {
        if (!invoiceValue) return null;
        if (lightningMode) return makeLightningInvoiceQr(invoiceValue);
        return makeQr({
            type: qr.lightning,
            value: {
                ...invoice,
                username,
                walletPK,
            },
        });
    }, [invoice, invoiceValue, lightningMode, username, walletPK]);
    const hasReceiveTransfer = useMemo(() => {
        if (!invoiceValue) return false;
        return Array.isArray(transfers) && transfers.some((tx) => isReceivePaymentTransfer(tx, { createdAt: shownAt, amountSats: invoice.amountSats }));
    }, [invoice?.amountSats, invoiceValue, shownAt, transfers]);

    const buildInvoice = useCallback(
        async (nextAmountSats = 0n) => {
            const result = await createLightningInvoice({
                amountSats: nextAmountSats,
                memo: 'veyl payment',
                includeSparkInvoice: true,
            });
            if (!result?.success) {
                throw result?.error || new Error('failed to create invoice');
            }
            if (!result?.invoice?.encodedInvoice) {
                throw new Error('invoice unavailable');
            }
            return result.invoice;
        },
        [createLightningInvoice]
    );

    useEffect(() => {
        if (!isFocused) return undefined;

        let cancelled = false;

        setLoading(true);
        buildInvoice(0n)
            .then((nextInvoice) => {
                if (cancelled) return;
                setInvoice(nextInvoice);
                setLightningMode(false);
                setPaid(false);
                setShownAt(Date.now());
                setError('');
            })
            .catch((err) => {
                if (cancelled) return;
                setInvoice(null);
                setError(err?.message || 'failed to create invoice');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [buildInvoice, isFocused]);

    const createInvoice = useCallback(async () => {
        if (creating) return;

        setCreating(true);
        setError('');
        try {
            const nextInvoice = await buildInvoice(amountSats);
            setInvoice(nextInvoice);
            setLightningMode(false);
            setPaid(false);
            setShownAt(Date.now());
        } catch (err) {
            setError(err?.message || 'failed to create invoice');
        } finally {
            setCreating(false);
        }
    }, [amountSats, buildInvoice, creating]);

    useEffect(() => {
        if (!invoice?.id) return undefined;

        let cancelled = false;
        let timer = null;
        const poll = async () => {
            const result = await getLightningReceiveRequest(invoice.id);
            if (cancelled) return;
            if (result?.success && isLightningReceiveDone(result.invoice?.status)) {
                setPaid(true);
                await refresh?.();
                return;
            }
            timer = setTimeout(poll, RECEIVE_POLL_MS);
        };

        void poll().catch(() => {
            if (!cancelled) timer = setTimeout(poll, RECEIVE_POLL_MS);
        });

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [getLightningReceiveRequest, invoice?.id, refresh]);

    useEffect(() => {
        paidScale.stopAnimation();
        if (!paid) {
            paidScale.setValue(1);
            return;
        }

        const animation = Animated.sequence([
            Animated.timing(paidScale, {
                toValue: 0.88,
                duration: RECEIVE_PAID_SHRINK_MS,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
            }),
            Animated.timing(paidScale, {
                toValue: 1.06,
                duration: RECEIVE_PAID_GROW_MS,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
        ]);
        animation.start(({ finished }) => {
            if (finished) router.dismiss();
        });
        return () => animation.stop();
    }, [paid, paidScale]);

    useEffect(() => {
        if (paid || !hasReceiveTransfer) return;
        setPaid(true);
        void refresh?.();
    }, [hasReceiveTransfer, paid, refresh]);

    const copyLightningQr = useCallback(() => {
        if (!lightningMode || paid || !qrValue) return;
        void Clipboard.setStringAsync(qrValue).catch(() => {});
    }, [lightningMode, paid, qrValue]);

    const cycleUnit = useCallback(() => {
        const i = MONEY_UNITS.indexOf(unit);
        const next = MONEY_UNITS[(i + 1) % MONEY_UNITS.length];
        if (amount) {
            try {
                const sats = toSats(amount, unit, price);
                setAmount(sats === 0n ? '' : toDisplay(sats, next, price));
            } catch {
                setAmount('');
            }
        }
        setUnit(next);
    }, [amount, price, unit]);

    const updateQrSize = (event) => {
        const width = Math.floor(event.nativeEvent.layout.width);
        if (width > 0 && width !== qrSize) {
            setQrSize(width);
        }
    };

    if (loading) {
        return (
            <View style={{ minHeight: 320, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={theme.foreground} />
            </View>
        );
    }

    const qrGraphic =
        qrValue && qrSize > 0 ? (
            <Animated.View style={{ transform: [{ scale: paidScale }] }}>
                <QRCode value={qrValue} size={qrSize} backgroundColor="transparent" color={paid ? theme.active : theme.foreground} />
            </Animated.View>
        ) : null;

    return (
        <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ alignItems: 'center', gap: 16, paddingHorizontal: 48, paddingTop: 24, paddingBottom: 28 }}>
            <GlassField disabled={creating} style={{ alignSelf: 'stretch', paddingHorizontal: 16 }}>
                <Icon icon={Zap} size={22} color={theme.muted} />
                <AmountInput
                    value={amount}
                    placeholder="0"
                    placeholderTextColor={theme.muted}
                    color={theme.foreground}
                    keyboardType={unit === 'sats' ? 'number-pad' : 'decimal-pad'}
                    onChangeText={setAmount}
                    editable={!creating}
                    keyboardAppearance={isDark ? 'dark' : 'light'}
                />
                <Pressable onPress={cycleUnit} hitSlop={8} disabled={creating} style={{ paddingLeft: 12, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ marginBottom: unit === 'sats' ? 2 : 0, fontSize: 24, fontWeight: '900', color: theme.muted }}>{unit === 'btc' ? 'btc' : unit === 'usd' ? '$' : 'sats'}</Text>
                </Pressable>
            </GlassField>

            <View style={{ alignSelf: 'stretch', alignItems: 'flex-start' }}>
                <GlassIcon icon={Zap} accent={lightningMode} onPress={() => setLightningMode((current) => !current)} disabled={creating || !invoiceValue} />
            </View>

            <View style={{ alignSelf: 'stretch', alignItems: 'center' }} onLayout={updateQrSize}>
                {qrGraphic && lightningMode ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="copy lightning invoice" onPress={copyLightningQr} disabled={creating || paid}>
                        {qrGraphic}
                    </Pressable>
                ) : null}
                {qrGraphic && !lightningMode ? qrGraphic : null}
            </View>

            {error ? (
                <Text selectable numberOfLines={2} style={{ minHeight: 20, color: theme.destructive, fontSize: 13, fontWeight: '900', textAlign: 'center' }}>
                    {error}
                </Text>
            ) : null}

            <View style={{ alignSelf: 'stretch', flexDirection: 'row', gap: 12 }}>
                <GlassButton onPress={createInvoice} icon={RefreshCw} label={creating ? 'updating...' : 'update qr'} accent disabled={creating} pressableStyle={{ flex: 1 }} />
            </View>
        </ScrollView>
    );
}
