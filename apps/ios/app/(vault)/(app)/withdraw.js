import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { PiggyBank, ScanQrCode } from 'lucide-react-native';
import { MONEY_UNITS, toDisplay, toSats } from '@veyl/shared/money';
import { COOPERATIVE_EXIT_FLAT_FEE_SATS, COOPERATIVE_EXIT_TX_VBYTES, formatOnchainFeeAmount, getWithdrawalFeeRisk } from '@veyl/shared/wallet/fees';
import { availableBalanceSats } from '@veyl/shared/wallet/balance';
import { isAddressOnNetwork, isMainnet } from '@veyl/shared/network';
import { textRouteParam } from '@veyl/shared/navigation/params';
import { BTC_PRICE_FALLBACK } from '@veyl/shared/config';

import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import AmountInput from '@/components/amountinput';
import GlassButton from '@/components/glass/glassbutton';
import GlassField from '@/components/glass/glassfield';
import GlassIcon from '@/components/glass/glassicon';
import Icon from '@/components/icon';
import { warmCamera } from '@/lib/camera/warming';
import { tap } from '@/lib/tap';
import { useRouteLock } from '@/lib/navigation/routelock';

export default function Withdraw() {
    const { theme, isDark } = useTheme();
    const { settings } = useUser();
    const bitcoin = useBitcoin();
    const { balance, withdrawFunds, network } = useWallet();
    const params = useLocalSearchParams();
    const prefillAddress = textRouteParam(params?.address);

    const amountInputRef = useRef(null);
    const openRef = useRef(true);
    const { lockRoute } = useRouteLock();

    const [receivingAddress, setReceivingAddress] = useState(prefillAddress);

    // keep address in sync when camera scans a new QR while the sheet is already open
    useEffect(() => {
        if (prefillAddress) setReceivingAddress(prefillAddress);
    }, [prefillAddress]);

    useEffect(() => {
        return () => {
            openRef.current = false;
        };
    }, []);

    const [amount, setAmount] = useState('');
    const [inputUnit, setInputUnit] = useState(settings?.moneyFormat || 'sats');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const cycleScale = useSharedValue(1);
    const scanScale = useSharedValue(1);
    const feeHelpScale = useSharedValue(1);

    const cycleUnit = useCallback(() => {
        const price = bitcoin?.price ?? BTC_PRICE_FALLBACK;
        const idx = MONEY_UNITS.indexOf(inputUnit);
        const next = MONEY_UNITS[(idx + 1) % MONEY_UNITS.length];
        if (amount) {
            const sats = toSats(amount, inputUnit, price);
            setAmount(sats === 0n ? '' : toDisplay(sats, next, price));
        }
        setInputUnit(next);
    }, [amount, inputUnit, bitcoin?.price]);

    const balanceSats = useMemo(() => availableBalanceSats(balance, null), [balance]);
    const enteredSats = useMemo(() => {
        if (!amount) return null;
        const price = bitcoin?.price ?? BTC_PRICE_FALLBACK;
        try {
            return toSats(amount, inputUnit, price);
        } catch {
            return null;
        }
    }, [amount, inputUnit, bitcoin?.price]);
    const amountAboveBalance = enteredSats != null && balanceSats != null && enteredSats > balanceSats;
    const validSats = enteredSats != null && enteredSats > 0n && !amountAboveBalance ? enteredSats : 0n;
    const setMaxAmount = useCallback(() => {
        if (balanceSats == null || balanceSats <= 0n) return;
        const price = bitcoin?.price ?? BTC_PRICE_FALLBACK;
        setAmount(toDisplay(balanceSats, inputUnit, price));
        amountInputRef.current?.focus?.();
    }, [balanceSats, bitcoin?.price, inputUnit]);

    const trimmedAddress = receivingAddress.trim();
    const hasAddress = trimmedAddress.length > 0;
    const addressOnNetwork = hasAddress && isAddressOnNetwork(trimmedAddress, network);
    const addressError = hasAddress && !addressOnNetwork ? (isMainnet(network) ? 'not a mainnet address' : 'not a regtest address') : '';
    const feeEstimate = useMemo(() => {
        const estimate = bitcoin.estimateTransactionFees({
            speed: 'medium',
            vbytes: COOPERATIVE_EXIT_TX_VBYTES,
            baseSats: COOPERATIVE_EXIT_FLAT_FEE_SATS,
        });
        return estimate?.success ? estimate.onchainEstimate : null;
    }, [bitcoin]);
    const feeAmountSats = feeEstimate?.feeAmountSats ?? null;
    const withdrawalFeeRisk = useMemo(
        () => getWithdrawalFeeRisk({ amountSats: validSats > 0n ? validSats : balanceSats, feeAmountSats }),
        [balanceSats, feeAmountSats, validSats]
    );
    const buttonFeedback = amountAboveBalance ? 'amount is above your balance' : '';
    const canSubmit = validSats > 0n && addressOnNetwork && !isSubmitting;
    const canSetMax = balanceSats != null && balanceSats > 0n && !isSubmitting;
    const hasFeeEstimate = feeAmountSats != null;
    const feeText = formatOnchainFeeAmount(feeEstimate, settings?.moneyFormat, bitcoin.price);
    const feeColor = withdrawalFeeRisk?.high ? theme.destructive : theme.foreground;
    const buttonLabel = isSubmitting ? 'withdrawing...' : buttonFeedback || 'withdraw';
    const handleWithdraw = useCallback(async () => {
        if (!canSubmit) return;
        if (!withdrawFunds) {
            Alert.alert('Not ready', 'Your wallet is still loading. Please try again in a moment.');
            return;
        }
        Keyboard.dismiss();
        setIsSubmitting(true);

        if (!lockRoute()) {
            if (openRef.current) {
                setIsSubmitting(false);
            }
            return;
        }

        router.back();

        const result = await withdrawFunds({
            onchainAddress: trimmedAddress,
            amountSats: Number(validSats),
            exitSpeed: 'MEDIUM',
        });

        if (!result.success) {
            Alert.alert('Withdraw failed', result.error?.message || 'Failed to withdraw.');
        }

        if (openRef.current) {
            setIsSubmitting(false);
        }
    }, [canSubmit, lockRoute, trimmedAddress, validSats, withdrawFunds]);

    const handleScanPress = useCallback(() => {
        if (!lockRoute()) return;
        warmCamera();
        router.dismiss();
        router.navigate('/camera');
    }, [lockRoute]);

    const handleFeeHelpPress = useCallback(() => {
        if (!lockRoute()) return;
        router.push('/withdrawalinfo');
    }, [lockRoute]);

    const scanPress = tap({ value: scanScale, disabled: isSubmitting, onPress: handleScanPress });
    const cyclePress = tap({ value: cycleScale, disabled: isSubmitting, onPress: cycleUnit });
    const feeHelpPress = tap({ value: feeHelpScale, disabled: isSubmitting, onPress: handleFeeHelpPress });

    const cycleStyle = useAnimatedStyle(() => ({ transform: [{ scale: cycleScale.value }] }));
    const scanStyle = useAnimatedStyle(() => ({ transform: [{ scale: scanScale.value }] }));
    const feeHelpStyle = useAnimatedStyle(() => ({ transform: [{ scale: feeHelpScale.value }] }));

    return (
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 32 }}>
            <Pressable
                {...feeHelpPress}
                accessibilityRole="button"
                accessibilityLabel="withdrawal fee info"
                hitSlop={8}
                disabled={isSubmitting}
                style={{ alignSelf: 'flex-start', maxWidth: '100%', paddingHorizontal: 4, marginBottom: 4 }}
            >
                <Animated.Text numberOfLines={1} style={[{ color: feeColor, fontSize: 17, fontWeight: '900' }, feeHelpStyle]}>
                    estimated fee: {`${hasFeeEstimate ? '~' : ''}${feeText}`}
                </Animated.Text>
            </Pressable>
            <View style={{ gap: 12 }}>
                {/* receiving address */}
                <GlassField disabled={isSubmitting} style={{ gap: 6, paddingRight: 12, paddingLeft: 14, paddingVertical: 8 }}>
                    <TextInput
                        value={receivingAddress}
                        placeholder="receiving address"
                        placeholderTextColor={theme.muted}
                        style={{ flex: 1, color: theme.foreground, fontSize: 18, paddingVertical: 4 }}
                        onChangeText={setReceivingAddress}
                        keyboardAppearance={isDark ? 'dark' : 'light'}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!isSubmitting}
                    />
                    <Pressable {...scanPress} hitSlop={8} disabled={isSubmitting}>
                        <Animated.View style={[{ padding: 6 }, scanStyle]}>
                            <Icon icon={ScanQrCode} size={22} color={theme.muted} />
                        </Animated.View>
                    </Pressable>
                </GlassField>
                {addressError ? <Text style={{ color: theme.destructive, fontSize: 13, paddingHorizontal: 4 }}>{addressError}</Text> : null}
                {/* amount input */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <GlassField disabled={isSubmitting} style={{ flex: 1, paddingHorizontal: 16 }}>
                        <AmountInput
                            ref={amountInputRef}
                            value={amount}
                            placeholder={inputUnit === 'sats' ? '0000' : '0.00'}
                            placeholderTextColor={theme.muted}
                            color={theme.foreground}
                            keyboardType="numeric"
                            onChangeText={setAmount}
                            editable={!isSubmitting}
                        />
                        <Pressable {...cyclePress} hitSlop={8} disabled={isSubmitting}>
                            <Animated.View style={[{ paddingLeft: 12, alignItems: 'center', justifyContent: 'center' }, cycleStyle]}>
                                {inputUnit === 'btc' && <Text style={{ fontSize: 24, fontWeight: '900', color: theme.muted }}>₿</Text>}
                                {inputUnit === 'usd' && <Text style={{ fontSize: 24, fontWeight: '900', color: theme.muted }}>$</Text>}
                                {inputUnit === 'sats' && <Text style={{ marginBottom: 2, fontSize: 24, fontWeight: '900', color: theme.muted }}>sats</Text>}
                            </Animated.View>
                        </Pressable>
                    </GlassField>
                    <GlassIcon icon={PiggyBank} onPress={setMaxAmount} disabled={!canSetMax} size={54} iconSize={26} />
                </View>
                {/* withdraw button */}
                <GlassButton onPress={handleWithdraw} label={buttonLabel} accent disabled={!canSubmit} tintColor={buttonFeedback ? theme.destructive : undefined} color={buttonFeedback ? theme.background : undefined} />
            </View>
        </View>
    );
}
