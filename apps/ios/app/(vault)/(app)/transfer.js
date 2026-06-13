import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { ArrowDownLeft, ArrowUpRight, Zap } from 'lucide-react-native';

import Avatar from '@/components/avatar';
import AmountInput from '@/components/amountinput';
import GlassButton from '@/components/glass/glassbutton';
import GlassField from '@/components/glass/glassfield';
import GlassIcon from '@/components/glass/glassicon';
import Icon from '@/components/icon';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { useChat } from '@/providers/chatprovider';
import { usePeer } from '@/providers/peerprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import { releaseInvoiceScan, suppressInvoiceScan } from '@/lib/invoicescan';
import { tap } from '@/lib/tap';
import { makeReq } from '@veyl/shared/chat/messages';
import { BTC_PRICE_FALLBACK, REQUEST_MONEY_MAX_SATS } from '@veyl/shared/config';
import { textRouteParam } from '@veyl/shared/navigation/params';
import { qr } from '@veyl/shared/qr';
import { SEND_ON_SCAN_ENABLED } from '@veyl/shared/settings';
import { lowerText } from '@veyl/shared/utils/text';
import { MONEY_UNITS, renderMoney, toDisplay, toSats } from '@veyl/shared/money';
import { formatUserDisplay } from '@veyl/shared/profile';
import { availableBalanceSats } from '@veyl/shared/wallet/balance';

function flag(value) {
    const raw = lowerText(textRouteParam(value));
    return raw === '1' || raw === 'true' || raw === 'yes';
}

function InvoiceMark({ theme, size = 64 }) {
    return (
        <View
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.glassBackground,
                borderWidth: 1,
                borderColor: theme.border,
            }}
        >
            <Icon icon={Zap} size={Math.round(size * 0.46)} color={theme.foreground} />
        </View>
    );
}

export default function PaymentScreen() {
    const { theme, isDark } = useTheme();
    const { settings, walletPK: ownWalletPK, chatBanned } = useUser();
    const bitcoin = useBitcoin();
    const { sendMoneyWithSpark, payExternalInvoice, balance } = useWallet();
    const { sendMessage } = useChat() || {};
    const { peerByUid, peerByWalletPK, peerByUsername, addPeer } = usePeer() || {};
    const params = useLocalSearchParams();

    const uid = textRouteParam(params?.uid).trim();
    const username = textRouteParam(params?.username).trim();
    const walletPK = textRouteParam(params?.walletPK).trim();
    const invoiceType = lowerText(textRouteParam(params?.invoiceType)).trim();
    const invoice = textRouteParam(params?.invoice).trim();
    const rawAmount = textRouteParam(params?.amount).trim();
    const presetMode = lowerText(textRouteParam(params?.mode));
    const forceSend = flag(params?.send);
    const autoSend = SEND_ON_SCAN_ENABLED && flag(params?.auto);
    const price = bitcoin?.price ?? BTC_PRICE_FALLBACK;
    const preset = rawAmount.length > 0;
    const isInvoice = !!invoice && (invoiceType === qr.lightning || invoiceType === qr.spark);

    const inputRef = useRef(null);
    const busyRef = useRef(false);
    const autoSendRef = useRef(false);

    const [fetchedPeer, setFetchedPeer] = useState(null);
    const [amount, setAmount] = useState('');
    const [unit, setUnit] = useState(settings?.moneyFormat || 'sats');
    const [mode, setMode] = useState('send');

    const presetSats = useMemo(() => {
        if (!rawAmount) return 0n;
        try {
            return BigInt(rawAmount);
        } catch {
            return 0n;
        }
    }, [rawAmount]);

    const balanceSats = useMemo(() => availableBalanceSats(balance), [balance]);

    const knownPeer = useMemo(() => {
        if (uid) {
            const byUid = peerByUid?.get(uid);
            if (byUid) return byUid;
        }
        if (username) {
            const byUsername = peerByUsername?.get(username);
            if (byUsername) return byUsername;
        }
        if (!walletPK) return null;
        return peerByWalletPK?.get(walletPK) ?? null;
    }, [peerByUid, peerByUsername, peerByWalletPK, uid, username, walletPK]);

    const peer = useMemo(() => knownPeer ?? fetchedPeer ?? (uid || username || walletPK ? { uid: uid || null, username: username || null, walletPK: walletPK || null } : null), [fetchedPeer, knownPeer, uid, username, walletPK]);
    const peerWalletPK = isInvoice ? null : peer?.walletPK || walletPK;
    const peerChatPK = isInvoice ? null : peer?.chatPK || null;
    const avatar = peer?.avatar ? { uri: peer.avatar } : null;
    const name = useMemo(() => {
        if (isInvoice && (peer || username || walletPK)) return formatUserDisplay(peer || { username, walletPK }, false);
        if (isInvoice) return invoiceType === qr.spark ? 'Spark invoice' : 'Lightning invoice';
        if (!peer && !walletPK) return 'user';
        return formatUserDisplay(peer || { walletPK }, false);
    }, [invoiceType, isInvoice, peer, username, walletPK]);
    const showInvoiceMark = isInvoice && !peer?.username && !peer?.walletPK && !username && !walletPK;

    useEffect(() => {
        setFetchedPeer(null);
    }, [invoice, invoiceType, uid, username, walletPK]);

    useEffect(() => {
        autoSendRef.current = false;
    }, [autoSend, invoice, invoiceType, rawAmount, uid, username, walletPK]);

    useEffect(() => {
        if ((!uid && !username && !walletPK) || knownPeer || !addPeer) {
            return;
        }

        let cancelled = false;

        addPeer(uid ? { uid, ...(walletPK ? { walletPK } : {}), ...(username ? { username } : {}) } : username ? { username, ...(walletPK ? { walletPK } : {}) } : { walletPK })
            .then((nextPeer) => {
                if (!cancelled) setFetchedPeer(nextPeer ?? null);
            })
            .catch((err) => {
                console.warn('payment peer lookup failed', err);
            });

        return () => {
            cancelled = true;
        };
    }, [addPeer, knownPeer, uid, username, walletPK]);

    useEffect(() => {
        setMode(!isInvoice && presetMode === 'request' ? 'request' : 'send');
    }, [forceSend, invoice, invoiceType, isInvoice, presetMode, rawAmount, uid, username, walletPK]);

    useEffect(() => {
        if ((isInvoice || chatBanned) && mode === 'request') {
            setMode('send');
        }
    }, [chatBanned, isInvoice, mode]);

    useEffect(() => {
        if (preset) return;

        setAmount('');
        setUnit(settings?.moneyFormat || 'sats');

        requestAnimationFrame(() => {
            inputRef.current?.focus?.();
        });
    }, [invoice, invoiceType, preset, settings?.moneyFormat, uid, username, walletPK]);

    const maxSats = !isInvoice && mode === 'request' ? REQUEST_MONEY_MAX_SATS : balanceSats;
    const typedSats = useMemo(() => {
        if (!amount) return 0n;
        try {
            const sats = toSats(amount, unit, price);
            if (sats <= 0n || sats > maxSats) return 0n;
            return sats;
        } catch {
            return 0n;
        }
    }, [amount, maxSats, price, unit]);

    const paymentSats = preset ? presetSats : typedSats;
    const amountText = presetSats > 0n ? renderMoney(presetSats.toString(), settings?.moneyFormat || 'sats', price) : '—';
    const canSend = isInvoice ? !!invoice && paymentSats > 0n && paymentSats <= balanceSats : !!peerWalletPK && paymentSats > 0n && paymentSats <= balanceSats && peerWalletPK !== ownWalletPK;
    const canRequest = !isInvoice && !chatBanned && !!peerChatPK && paymentSats > 0n;
    const actionLabel = isInvoice ? `pay ${name}` : mode === 'request' ? (peer ? `request from ${name}` : 'request') : peer ? `send to ${name}` : 'send';
    const actionDisabled = mode === 'request' ? !canRequest : !canSend;
    const modeIcon = mode === 'request' ? ArrowDownLeft : ArrowUpRight;

    const unitScale = useSharedValue(1);
    const unitStyle = useAnimatedStyle(() => ({ transform: [{ scale: unitScale.value }] }));

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
    const unitPress = tap({ value: unitScale, onPress: cycleUnit });

    const toggleMode = useCallback(() => {
        if (isInvoice || forceSend || chatBanned) return;
        setMode((current) => (current === 'send' ? 'request' : 'send'));
    }, [chatBanned, forceSend, isInvoice]);

    const closeRoute = useCallback(() => router.dismiss(), []);

    const handlePayment = useCallback(() => {
        if (actionDisabled || busyRef.current) return;

        if (mode === 'request') {
            if (!peerChatPK) {
                Alert.alert('Chat unavailable', 'This person cannot receive requests yet.');
                return;
            }
            if (!sendMessage) {
                Alert.alert('Request failed', 'Chat is unavailable.');
                return;
            }

            busyRef.current = true;
            closeRoute();

            void sendMessage(peerChatPK, makeReq(paymentSats.toString())).catch((err) => {
                Alert.alert('Request failed', err?.message || 'Failed to send request.');
            });
            return;
        }

        if (isInvoice) {
            busyRef.current = true;
            suppressInvoiceScan({ type: invoiceType, invoice });
            closeRoute();

            void payExternalInvoice({
                type: invoiceType,
                invoice,
                amountSats: paymentSats,
                variableAmount: !preset,
            })
                .then(() => {
                    suppressInvoiceScan({ type: invoiceType, invoice });
                })
                .catch((err) => {
                    releaseInvoiceScan({ type: invoiceType, invoice });
                    Alert.alert('Payment failed', err?.message || 'Failed to pay invoice.');
                });
            return;
        }

        if (!peerWalletPK) {
            Alert.alert('Wallet unavailable', 'This person cannot receive money yet.');
            return;
        }

        busyRef.current = true;
        closeRoute();

        void sendMoneyWithSpark(peerWalletPK, Number(paymentSats)).catch((err) => {
            Alert.alert('Send failed', err?.message || 'Failed to send money.');
        });
    }, [actionDisabled, closeRoute, invoice, invoiceType, isInvoice, mode, payExternalInvoice, paymentSats, peerChatPK, peerWalletPK, preset, sendMessage, sendMoneyWithSpark]);

    useEffect(() => {
        if (!autoSend || !forceSend || !preset || autoSendRef.current || !canSend) {
            return;
        }

        autoSendRef.current = true;
        handlePayment();
    }, [autoSend, canSend, forceSend, handlePayment, preset]);

    return (
        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 32, justifyContent: 'space-between', gap: 16 }}>
            <View style={{ flex: 1, justifyContent: 'center', gap: preset ? 0 : 16 }}>
                {preset ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, width: '100%' }}>
                        {showInvoiceMark ? <InvoiceMark theme={theme} /> : <Avatar source={avatar} size={64} />}
                        <Text numberOfLines={1} adjustsFontSizeToFit style={{ flexShrink: 1, fontSize: 64, fontWeight: '900', color: theme.foreground }}>
                            {amountText}
                        </Text>
                    </View>
                ) : (
                    <>
                        <View style={{ alignItems: 'center' }}>
                            {showInvoiceMark ? <InvoiceMark theme={theme} /> : <Avatar source={avatar} size={64} />}
                        </View>
                        <GlassField style={{ paddingHorizontal: 16 }}>
                            <AmountInput
                                ref={inputRef}
                                value={amount}
                                placeholder={unit === 'sats' ? '0000' : '0.00'}
                                placeholderTextColor={theme.muted}
                                color={theme.foreground}
                                keyboardType="numeric"
                                onChangeText={setAmount}
                                keyboardAppearance={isDark ? 'dark' : 'light'}
                            />
                            <Pressable {...unitPress} hitSlop={8}>
                                <Animated.View style={[{ paddingLeft: 12, alignItems: 'center', justifyContent: 'center' }, unitStyle]}>
                                    {unit === 'btc' && <Text style={{ fontSize: 24, fontWeight: '900', color: theme.muted }}>₿</Text>}
                                    {unit === 'usd' && <Text style={{ fontSize: 24, fontWeight: '900', color: theme.muted }}>$</Text>}
                                    {unit === 'sats' && <Text style={{ marginBottom: 2, fontSize: 24, fontWeight: '900', color: theme.muted }}>sats</Text>}
                                </Animated.View>
                            </Pressable>
                        </GlassField>
                    </>
                )}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {!forceSend && !isInvoice ? <GlassIcon icon={modeIcon} iconSize={32} onPress={toggleMode} disabled={chatBanned} /> : null}
                <GlassButton onPress={handlePayment} label={actionLabel} accent disabled={actionDisabled} pressableStyle={{ flex: 1 }} />
            </View>
        </View>
    );
}
