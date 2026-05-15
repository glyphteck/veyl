import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Check, Copy } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import { makeQr, makeUserQr, qr } from '@glyphteck/shared/qrutils';
import { resolveNetwork } from '@glyphteck/shared/network';

import Avatar from '@/components/avatar';
import { useTap } from '@/lib/tap';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';

function pickParam(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value[0] || '';
    return '';
}

export default function ScanScreen() {
    const { theme } = useTheme();
    const isFocused = useIsFocused();
    const { username, avatar, active } = useUser();
    const { fundingAddress, getFundingAddress } = useWallet();
    const params = useLocalSearchParams();
    const type = pickParam(params?.type) === 'share' ? 'share' : 'fund';
    const isFund = type === 'fund';
    const network = resolveNetwork(globalThis?.process?.env ?? {});
    const isTestEnv = network !== 'MAINNET';
    const [address, setAddress] = useState(fundingAddress);
    const [loading, setLoading] = useState(isFund && !fundingAddress);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (isFocused) {
            setCopied(false);
        }
    }, [isFocused, type]);

    useEffect(() => {
        if (!isFund) {
            setLoading(false);
            return;
        }

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
                if (cancelled) {
                    return;
                }
                setAddress(addr || null);
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) {
                    return;
                }
                setAddress(null);
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [fundingAddress, getFundingAddress, isFund]);

    useEffect(() => {
        if (!isFund || !address) {
            return;
        }

        void Clipboard.setStringAsync(address).catch(() => {});
    }, [address, isFund]);

    const qrValue = useMemo(() => {
        if (isFund) {
            if (!address) return null;
            return makeQr({ type: qr.bitcoin, value: address });
        }

        if (!username) return null;
        const qrData = makeUserQr({ username });
        if (!qrData) return null;
        return makeQr({ type: qr.user, value: qrData });
    }, [address, isFund, username]);

    const title = isFund ? 'address copied to clipboard' : username ? `@${username}` : 'share your veyl';
    const body = isFund
        ? 'send bitcoin to this address to fund your account. this is a normal bitcoin transaction. it will take around 30 minutes to confirm, and you will pay fees on it.'
        : 'share your account to receive money or connect with people faster.';
    const emptyLabel = isFund ? 'wallet not ready' : 'profile not ready';
    const avatarSource = avatar ? { uri: avatar } : null;
    const copyLabel = copied ? 'copied to clipboard' : 'tap to copy';
    const copyLabelColor = copied ? theme.foreground : theme.muted;
    const CopyIcon = copied ? Check : Copy;
    const copyTap = useTap({
        scale: 0.94,
        onPress: () => {
            if (!address) return;
            void Clipboard.setStringAsync(address)
                .then(() => setCopied(true))
                .catch(() => {});
        },
    });

    return (
        <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 32, paddingTop: 16 }}>
            {loading ? (
                <View style={{ flex: 1, justifyContent: 'center' }}>
                    <ActivityIndicator size="large" color={theme.muted} />
                </View>
            ) : qrValue ? (
                <>
                    {!isFund ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
                            <Avatar source={avatarSource} active={!!active} size={56} />
                            <Text style={{ fontSize: 30, fontWeight: '900', color: theme.foreground, textAlign: 'center' }}>{title}</Text>
                        </View>
                    ) : null}
                    {isFund ? (
                        <Pressable accessibilityRole="button" accessibilityLabel="copy funding address" {...copyTap.props}>
                            <Animated.View style={{ alignItems: 'center', paddingVertical: 24, transform: [{ scale: copyTap.scale }] }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                                    <CopyIcon size={15} color={copyLabelColor} strokeWidth={3} />
                                    <Text style={{ color: copyLabelColor, fontSize: 13, fontWeight: '900', textAlign: 'center' }}>{copyLabel}</Text>
                                </View>
                                <QRCode value={qrValue} size={256} backgroundColor="transparent" color={theme.foreground} />
                            </Animated.View>
                        </Pressable>
                    ) : (
                        <View
                            style={{
                                paddingVertical: 24,
                            }}
                        >
                            <QRCode value={qrValue} size={256} backgroundColor="transparent" color={theme.foreground} />
                        </View>
                    )}
                    <Text style={{ color: theme.foreground, marginTop: 8, fontSize: 16, fontWeight: '900', textAlign: 'center' }}>{body}</Text>
                    {isFund && isTestEnv ? (
                        <View style={{ marginTop: 10, flexDirection: 'row', justifyContent: 'center', paddingHorizontal: 16 }}>
                            <Text style={{ color: theme.destructive, fontSize: 12, fontWeight: '900', textAlign: 'center', lineHeight: 18 }}>
                                YOU ARE CURRENTLY IN TEST ENVIRONMENT. DO NOT SEND REAL BITCOIN TO THIS ADDRESS.
                            </Text>
                        </View>
                    ) : null}
                </>
            ) : (
                <View style={{ flex: 1, justifyContent: 'center' }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: theme.muted }}>{emptyLabel}</Text>
                </View>
            )}
        </View>
    );
}
