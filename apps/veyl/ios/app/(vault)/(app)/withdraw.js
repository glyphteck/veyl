import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { ScanQrCode } from 'lucide-react-native';
import { toSats, toDisplay } from '@glyphteck/shared/utils';
import { minWithdrawalSats } from '@glyphteck/shared/spark';
import { isAddressOnNetwork, isMainnet } from '@glyphteck/shared/network';

import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import GlassButton from '@/components/glass/glassbutton';
import GlassField from '@/components/glass/glassfield';
import Icon from '@/components/icon';
import { warmCamera } from '@/lib/camerawarm';
import { tap } from '@/lib/tap';

const UNITS = ['sats', 'btc', 'usd'];
export default function Withdraw() {
    const { theme, isDark } = useTheme();
    const { settings } = useUser();
    const { balance, bitcoin, withdrawFunds, network } = useWallet();
    const isTestEnv = !isMainnet(network);
    const { address: prefillAddress = '' } = useLocalSearchParams();

    const amountInputRef = useRef(null);
    const openRef = useRef(true);
    const routeLockRef = useRef(false);
    const routeLockTimerRef = useRef(null);

    const [receivingAddress, setReceivingAddress] = useState(prefillAddress);

    // keep address in sync when camera scans a new QR while the sheet is already open
    useEffect(() => {
        if (prefillAddress) setReceivingAddress(prefillAddress);
    }, [prefillAddress]);

    useEffect(() => {
        return () => {
            openRef.current = false;
            if (routeLockTimerRef.current) clearTimeout(routeLockTimerRef.current);
        };
    }, []);

    const [amount, setAmount] = useState('');
    const [inputUnit, setInputUnit] = useState(settings?.moneyFormat || 'sats');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const cycleScale = useSharedValue(1);
    const scanScale = useSharedValue(1);

    const cycleUnit = useCallback(() => {
        const price = bitcoin?.price ?? 100000;
        const idx = UNITS.indexOf(inputUnit);
        const next = UNITS[(idx + 1) % UNITS.length];
        if (amount) {
            const sats = toSats(amount, inputUnit, price);
            setAmount(sats === 0n ? '' : toDisplay(sats, next, price));
        }
        setInputUnit(next);
    }, [amount, inputUnit, bitcoin?.price]);

    const validSats = useMemo(() => {
        if (!amount) return 0n;
        const price = bitcoin?.price ?? 100000;
        const max = balance != null ? BigInt(Math.floor(Number(balance))) : 0n;
        try {
            const sats = toSats(amount, inputUnit, price);
            if (sats < minWithdrawalSats || sats > max) return 0n;
            return sats;
        } catch {
            return 0n;
        }
    }, [amount, inputUnit, bitcoin?.price, balance]);

    const trimmedAddress = receivingAddress.trim();
    const hasAddress = trimmedAddress.length > 0;
    const addressOnNetwork = hasAddress && isAddressOnNetwork(trimmedAddress, network);
    const addressError = hasAddress && !addressOnNetwork ? (isMainnet(network) ? 'not a mainnet address' : 'not a regtest address') : '';
    const canSubmit = validSats > 0n && addressOnNetwork && !isSubmitting;
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

    const handleWithdraw = useCallback(async () => {
        if (!canSubmit) return;
        if (!withdrawFunds) {
            Alert.alert('Not available', 'Withdraw is not yet supported.');
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

    const scanPress = tap({ value: scanScale, disabled: isSubmitting, onPress: handleScanPress });
    const cyclePress = tap({ value: cycleScale, disabled: isSubmitting, onPress: cycleUnit });

    const cycleStyle = useAnimatedStyle(() => ({ transform: [{ scale: cycleScale.value }] }));
    const scanStyle = useAnimatedStyle(() => ({ transform: [{ scale: scanScale.value }] }));

    return (
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 32, gap: 12 }}>
            {isTestEnv ? (
                <Text style={{ color: theme.destructive, fontSize: 12, fontWeight: '900', textAlign: 'center', lineHeight: 18 }}>
                    YOU ARE IN TEST ENVIRONMENT. DO NOT SEND REAL BITCOIN.
                </Text>
            ) : null}
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
            <GlassField disabled={isSubmitting} style={{ paddingHorizontal: 16 }}>
                <TextInput
                    ref={amountInputRef}
                    value={amount}
                    placeholder={inputUnit === 'sats' ? '0000' : '0.00'}
                    placeholderTextColor={theme.muted}
                    keyboardType="numeric"
                    onChangeText={setAmount}
                    editable={!isSubmitting}
                    style={{ flex: 1, fontSize: 24, fontWeight: '900', color: theme.foreground, paddingVertical: 10 }}
                />
                <Pressable {...cyclePress} hitSlop={8} disabled={isSubmitting}>
                    <Animated.View style={[{ paddingLeft: 12, alignItems: 'center', justifyContent: 'center' }, cycleStyle]}>
                        {inputUnit === 'btc' && <Text style={{ fontSize: 24, fontWeight: '900', color: theme.muted }}>₿</Text>}
                        {inputUnit === 'usd' && <Text style={{ fontSize: 24, fontWeight: '900', color: theme.muted }}>$</Text>}
                        {inputUnit === 'sats' && <Text style={{ marginBottom: 2, fontSize: 24, fontWeight: '900', color: theme.muted }}>sats</Text>}
                    </Animated.View>
                </Pressable>
            </GlassField>
            {/* withdraw button */}
            <GlassButton onPress={handleWithdraw} label={isSubmitting ? 'withdrawing...' : 'withdraw'} accent disabled={!canSubmit} />
        </View>
    );
}
