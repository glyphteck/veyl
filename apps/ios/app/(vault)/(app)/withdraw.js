import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { PiggyBank, ScanQrCode } from 'lucide-react-native';
import { MONEY_UNITS, renderMoney, toDisplay, toSats } from '@veyl/shared/money';
import { COOPERATIVE_EXIT_FLAT_FEE_SATS, COOPERATIVE_EXIT_TX_VBYTES, formatOnchainFeeAmount, getWithdrawalFeeRisk } from '@veyl/shared/wallet/fees';
import { getWithdrawalReviewAmounts } from '@veyl/shared/wallet/withdraw';
import { availableBalanceSats } from '@veyl/shared/wallet/balance';
import { isAddressOnNetwork, isMainnet } from '@veyl/shared/network';
import { textRouteParam } from '@veyl/shared/navigation/params';
import { BTC_PRICE_FALLBACK } from '@veyl/shared/config';
import { truncateAddress } from '@veyl/shared/utils/display';
import btcLogo from '@veyl/shared/logos/btc.png';

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

function cleanAddressInput(value) {
    return String(value ?? '').replace(/\s+/g, '');
}

function ReviewAmount({ label, value, color, labelColor, fontSize = 44 }) {
    return (
        <View style={{ width: '100%', minWidth: 0, alignItems: 'center' }}>
            <Text style={{ color: labelColor ?? color, fontSize: 16, lineHeight: 20, fontWeight: '900', textAlign: 'center' }}>{label}</Text>
            <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                style={{ width: '100%', color, fontSize, lineHeight: fontSize + 5, fontWeight: '900', fontVariant: ['tabular-nums'], textAlign: 'center' }}
            >
                {value}
            </Text>
        </View>
    );
}

export default function Withdraw() {
    const { theme, isDark } = useTheme();
    const { settings } = useUser();
    const bitcoin = useBitcoin();
    const { balance, prepareWithdrawal, confirmWithdrawal, network } = useWallet();
    const params = useLocalSearchParams();
    const prefillAddress = textRouteParam(params?.address);

    const amountInputRef = useRef(null);
    const openRef = useRef(true);
    const copyResetRef = useRef(null);
    const { lockRoute } = useRouteLock();

    const [receivingAddress, setReceivingAddress] = useState(cleanAddressInput(prefillAddress));
    const [amount, setAmount] = useState('');
    const [inputUnit, setInputUnit] = useState(settings?.moneyFormat || 'sats');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [review, setReview] = useState(null);
    const [copiedReviewAddress, setCopiedReviewAddress] = useState(false);

    // keep address in sync when camera scans a new QR while the sheet is already open
    useEffect(() => {
        if (prefillAddress) {
            setReceivingAddress(cleanAddressInput(prefillAddress));
            setReview(null);
        }
    }, [prefillAddress]);

    useEffect(() => {
        return () => {
            openRef.current = false;
            clearTimeout(copyResetRef.current);
        };
    }, []);

    const cycleScale = useSharedValue(1);
    const scanScale = useSharedValue(1);
    const feeHelpScale = useSharedValue(1);
    const copyScale = useSharedValue(1);

    const cycleUnit = useCallback(() => {
        const price = bitcoin?.price ?? BTC_PRICE_FALLBACK;
        const idx = MONEY_UNITS.indexOf(inputUnit);
        const next = MONEY_UNITS[(idx + 1) % MONEY_UNITS.length];
        if (amount) {
            const sats = toSats(amount, inputUnit, price);
            setAmount(sats === 0n ? '' : toDisplay(sats, next, price));
        }
        setInputUnit(next);
        setReview(null);
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
        setReview(null);
        amountInputRef.current?.focus?.();
    }, [balanceSats, bitcoin?.price, inputUnit]);

    const trimmedAddress = cleanAddressInput(receivingAddress);
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
    const reviewAmounts = useMemo(() => {
        if (!review) return null;
        try {
            return getWithdrawalReviewAmounts(review);
        } catch {
            return null;
        }
    }, [review]);
    const withdrawalFeeRisk = useMemo(() => {
        if (!reviewAmounts) return null;
        return getWithdrawalFeeRisk({ amountSats: reviewAmounts.sendAmountSats, feeAmountSats: reviewAmounts.feeAmountSats });
    }, [reviewAmounts]);
    const estimatedWithdrawalFeeRisk = useMemo(
        () => getWithdrawalFeeRisk({ amountSats: validSats > 0n ? validSats : balanceSats, feeAmountSats }),
        [balanceSats, feeAmountSats, validSats]
    );
    const buttonFeedback = !review && amountAboveBalance ? 'amount is above your balance' : '';
    const canSubmit = !review && validSats > 0n && addressOnNetwork && !isSubmitting;
    const canConfirm = !!review && !!reviewAmounts && !isSubmitting;
    const canSetMax = balanceSats != null && balanceSats > 0n && !isSubmitting;
    const feeColor = (review ? withdrawalFeeRisk : estimatedWithdrawalFeeRisk)?.high ? theme.destructive : theme.foreground;
    const price = bitcoin?.price ?? BTC_PRICE_FALLBACK;
    const sendText = reviewAmounts ? renderMoney(reviewAmounts.sendAmountSats, settings?.moneyFormat || 'sats', price) : '';
    const receiveText = reviewAmounts ? renderMoney(reviewAmounts.receiveAmountSats, settings?.moneyFormat || 'sats', price) : '';
    const feeText = reviewAmounts ? renderMoney(reviewAmounts.feeAmountSats, settings?.moneyFormat || 'sats', price) : '';
    const estimateText = formatOnchainFeeAmount(feeEstimate, settings?.moneyFormat, bitcoin.price);
    const hasFeeEstimate = feeAmountSats != null;
    const reviewAddress = review?.onchainAddress || '';
    const reviewAddressLabel = truncateAddress(reviewAddress, 8, 6);
    const reviewActionAddress = truncateAddress(reviewAddress, 4, 4);
    const buttonLabel = isSubmitting ? (review ? 'sending...' : 'reviewing...') : review ? `send to ${reviewActionAddress}` : buttonFeedback || 'withdraw';
    const handleWithdraw = useCallback(async () => {
        if (review) {
            if (!canConfirm) return;
            if (!confirmWithdrawal) {
                Alert.alert('Not ready', 'Your wallet is still loading. Please try again in a moment.');
                return;
            }

            Keyboard.dismiss();
            setIsSubmitting(true);

            const result = await confirmWithdrawal(review);
            if (!result.success) {
                Alert.alert('Withdraw failed', result.error?.message || 'Failed to withdraw.');
                if (openRef.current) {
                    setIsSubmitting(false);
                }
                return;
            }

            if (openRef.current) {
                setIsSubmitting(false);
            }
            if (lockRoute()) {
                router.back();
            }
            return;
        }

        if (!canSubmit) return;
        if (!prepareWithdrawal) {
            Alert.alert('Not ready', 'Your wallet is still loading. Please try again in a moment.');
            return;
        }
        Keyboard.dismiss();
        setIsSubmitting(true);

        const result = await prepareWithdrawal({
            onchainAddress: trimmedAddress,
            amountSats: validSats,
            exitSpeed: 'MEDIUM',
        });

        if (result.success) {
            setReview(result.withdrawal);
        } else {
            Alert.alert('Withdraw failed', result.error?.message || 'Failed to prepare withdrawal.');
        }

        if (openRef.current) {
            setIsSubmitting(false);
        }
    }, [canConfirm, canSubmit, confirmWithdrawal, lockRoute, prepareWithdrawal, review, trimmedAddress, validSats]);

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

    const handleAddressChange = useCallback((nextAddress) => {
        setReceivingAddress(cleanAddressInput(nextAddress));
        setReview(null);
    }, []);

    const handleAmountChange = useCallback((nextAmount) => {
        setAmount(nextAmount);
        setReview(null);
    }, []);

    const copyReviewAddress = useCallback(() => {
        if (!reviewAddress) return;
        void Clipboard.setStringAsync(reviewAddress)
            .then(() => {
                setCopiedReviewAddress(true);
                clearTimeout(copyResetRef.current);
                copyResetRef.current = setTimeout(() => setCopiedReviewAddress(false), 1200);
            })
            .catch(() => {});
    }, [reviewAddress]);

    const scanPress = tap({ value: scanScale, disabled: isSubmitting, onPress: handleScanPress });
    const cyclePress = tap({ value: cycleScale, disabled: isSubmitting, onPress: cycleUnit });
    const feeHelpPress = tap({ value: feeHelpScale, disabled: isSubmitting, onPress: handleFeeHelpPress });
    const copyPress = tap({ value: copyScale, disabled: isSubmitting || !reviewAddress, onPress: copyReviewAddress });

    const cycleStyle = useAnimatedStyle(() => ({ transform: [{ scale: cycleScale.value }] }));
    const scanStyle = useAnimatedStyle(() => ({ transform: [{ scale: scanScale.value }] }));
    const feeHelpStyle = useAnimatedStyle(() => ({ transform: [{ scale: feeHelpScale.value }] }));
    const copyStyle = useAnimatedStyle(() => ({ transform: [{ scale: copyScale.value }] }));

    return (
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: review ? 28 : 32, paddingBottom: review ? 8 : 0 }}>
            {!review ? (
                <Pressable
                    {...feeHelpPress}
                    accessibilityRole="button"
                    accessibilityLabel="withdrawal fee info"
                    hitSlop={8}
                    disabled={isSubmitting}
                    style={{ alignSelf: 'flex-start', maxWidth: '100%', paddingHorizontal: 4, marginBottom: 4 }}
                >
                    <Animated.Text numberOfLines={1} style={[{ color: feeColor, fontSize: 17, fontWeight: '900' }, feeHelpStyle]}>
                        estimated fee: {`${hasFeeEstimate ? '~' : ''}${estimateText}`}
                    </Animated.Text>
                </Pressable>
            ) : null}
            <View style={{ gap: 12 }}>
                {review ? (
                    <>
                        <Pressable {...copyPress} accessibilityRole="button" accessibilityLabel="copy withdraw address" disabled={isSubmitting || !reviewAddress} hitSlop={6}>
                            <GlassField style={{ gap: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
                                <Animated.View style={[{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, copyStyle]}>
                                    <Image source={btcLogo} resizeMode="contain" style={{ width: 38, height: 38 }} />
                                </Animated.View>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text
                                        numberOfLines={1}
                                        adjustsFontSizeToFit
                                        minimumFontScale={0.75}
                                        style={{ width: '100%', color: theme.foreground, fontSize: 30, lineHeight: 34, fontWeight: '900' }}
                                    >
                                        {reviewAddressLabel}
                                    </Text>
                                    <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12, fontWeight: '900' }}>
                                        {copiedReviewAddress ? 'address copied' : 'copy address'}
                                    </Text>
                                </View>
                            </GlassField>
                        </Pressable>
                        <View style={{ gap: 12, paddingHorizontal: 8, paddingVertical: 10 }}>
                            <ReviewAmount label="send" value={sendText} color={theme.foreground} labelColor={theme.muted} />
                            <ReviewAmount label="fee" value={feeText} color={feeColor} labelColor={theme.muted} fontSize={36} />
                            <ReviewAmount label="receive" value={receiveText} color={theme.foreground} labelColor={theme.muted} />
                        </View>
                    </>
                ) : (
                    <>
                        <GlassField disabled={isSubmitting} style={{ gap: 6, paddingRight: 14, paddingLeft: 12, paddingVertical: 8 }}>
                            <TextInput
                                value={receivingAddress}
                                placeholder="receiving address"
                                placeholderTextColor={theme.muted}
                                multiline={false}
                                numberOfLines={1}
                                style={{ flex: 1, minWidth: 0, color: theme.foreground, fontSize: 18, paddingVertical: 4 }}
                                onChangeText={handleAddressChange}
                                keyboardAppearance={isDark ? 'dark' : 'light'}
                                autoCapitalize="none"
                                autoCorrect={false}
                                spellCheck={false}
                                editable={!isSubmitting}
                                returnKeyType="done"
                            />
                            <Pressable {...scanPress} hitSlop={8} disabled={isSubmitting}>
                                <Animated.View style={[{ paddingVertical: 1 }, scanStyle]}>
                                    <Icon icon={ScanQrCode} color={theme.muted} />
                                </Animated.View>
                            </Pressable>
                        </GlassField>
                        {addressError ? <Text style={{ color: theme.destructive, fontSize: 13, paddingHorizontal: 4 }}>{addressError}</Text> : null}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <GlassField disabled={isSubmitting} style={{ flex: 1, paddingHorizontal: 16 }}>
                                <AmountInput
                                    ref={amountInputRef}
                                    value={amount}
                                    placeholder={inputUnit === 'sats' ? '0000' : '0.00'}
                                    placeholderTextColor={theme.muted}
                                    color={theme.foreground}
                                    keyboardType="numeric"
                                    onChangeText={handleAmountChange}
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
                    </>
                )}
                <GlassButton
                    onPress={handleWithdraw}
                    label={buttonLabel}
                    accent
                    disabled={review ? !canConfirm : !canSubmit}
                    tintColor={buttonFeedback ? theme.destructive : undefined}
                    color={buttonFeedback ? theme.background : undefined}
                    textStyle={review ? { fontSize: 17 } : undefined}
                />
            </View>
        </View>
    );
}
