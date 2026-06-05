import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react-native';

import Avatar from '@/components/avatar';
import GlassButton from '@/components/glass/glassbutton';
import GlassField from '@/components/glass/glassfield';
import GlassIcon from '@/components/glass/glassicon';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { useChat } from '@/providers/chatprovider';
import { usePeer } from '@/providers/peerprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import { tap } from '@/lib/tap';
import { makeReq } from '@veyl/shared/chat/messages';
import { BTC_PRICE_FALLBACK, REQUEST_MONEY_MAX_SATS } from '@veyl/shared/config';
import { textRouteParam } from '@veyl/shared/navigation/params';
import { SEND_ON_SCAN_ENABLED } from '@veyl/shared/settings';
import { lowerText } from '@veyl/shared/utils/text';
import { MONEY_UNITS, renderMoney, toDisplay, toSats } from '@veyl/shared/money';
import { formatUserDisplay } from '@veyl/shared/profile';
import { availableBalanceSats } from '@veyl/shared/wallet/balance';

function flag(value) {
    const raw = lowerText(textRouteParam(value));
    return raw === '1' || raw === 'true' || raw === 'yes';
}

export default function TransferScreen() {
    const { theme, isDark } = useTheme();
    const { settings, walletPK: ownWalletPK, chatBanned } = useUser();
    const bitcoin = useBitcoin();
    const { sendMoneyWithSpark, balance } = useWallet();
    const { sendMessage } = useChat() || {};
    const { peerByUid, peerByWalletPK, addPeer } = usePeer() || {};
    const params = useLocalSearchParams();

    const uid = textRouteParam(params?.uid).trim();
    const walletPK = textRouteParam(params?.walletPK).trim();
    const rawAmount = textRouteParam(params?.amount).trim();
    const presetMode = lowerText(textRouteParam(params?.mode));
    const forceSend = flag(params?.send);
    const autoSend = SEND_ON_SCAN_ENABLED && flag(params?.auto);
    const price = bitcoin?.price ?? BTC_PRICE_FALLBACK;
    const preset = rawAmount.length > 0;

    const inputRef = useRef(null);
    const openRef = useRef(true);
    const busyRef = useRef(false);
    const autoSendRef = useRef(false);

    const [fetchedPeer, setFetchedPeer] = useState(null);
    const [isSending, setIsSending] = useState(false);
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
        if (!walletPK) return null;
        return peerByWalletPK?.get(walletPK) ?? null;
    }, [peerByUid, peerByWalletPK, uid, walletPK]);

    const peer = useMemo(() => knownPeer ?? fetchedPeer ?? (uid || walletPK ? { uid: uid || null, walletPK: walletPK || null } : null), [fetchedPeer, knownPeer, uid, walletPK]);
    const peerWalletPK = peer?.walletPK || walletPK;
    const peerChatPK = peer?.chatPK || null;
    const avatar = peer?.avatar ? { uri: peer.avatar } : null;
    const name = useMemo(() => {
        if (!peer && !walletPK) return 'user';
        return formatUserDisplay(peer || { walletPK }, false);
    }, [peer, walletPK]);

    useEffect(() => {
        setFetchedPeer(null);
    }, [uid, walletPK]);

    useEffect(() => {
        autoSendRef.current = false;
    }, [autoSend, rawAmount, uid, walletPK]);

    useEffect(() => {
        return () => {
            openRef.current = false;
        };
    }, []);

    useEffect(() => {
        if ((!uid && !walletPK) || knownPeer || !addPeer) {
            return;
        }

        let cancelled = false;

        addPeer(uid ? { uid, ...(walletPK ? { walletPK } : {}) } : { walletPK })
            .then((nextPeer) => {
                if (!cancelled) setFetchedPeer(nextPeer ?? null);
            })
            .catch((err) => {
                console.warn('transfer peer lookup failed', err);
            });

        return () => {
            cancelled = true;
        };
    }, [addPeer, knownPeer, uid, walletPK]);

    useEffect(() => {
        setMode(presetMode === 'request' ? 'request' : 'send');
    }, [forceSend, presetMode, rawAmount, uid, walletPK]);

    useEffect(() => {
        if (chatBanned && mode === 'request') {
            setMode('send');
        }
    }, [chatBanned, mode]);

    useEffect(() => {
        if (preset) return;

        setAmount('');
        setUnit(settings?.moneyFormat || 'sats');

        requestAnimationFrame(() => {
            inputRef.current?.focus?.();
        });
    }, [preset, settings?.moneyFormat, uid, walletPK]);

    const maxSats = mode === 'request' ? REQUEST_MONEY_MAX_SATS : balanceSats;
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

    const transferSats = preset ? presetSats : typedSats;
    const amountText = presetSats > 0n ? renderMoney(presetSats.toString(), settings?.moneyFormat || 'sats', price) : '—';
    const canSend = !!peerWalletPK && transferSats > 0n && transferSats <= balanceSats && !isSending && peerWalletPK !== ownWalletPK;
    const canRequest = !chatBanned && !!peerChatPK && transferSats > 0n && !isSending;
    const actionLabel = mode === 'request' ? (isSending ? 'requesting...' : peer ? `request from ${name}` : 'request') : isSending ? 'sending...' : peer ? `send to ${name}` : 'send';
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
    const unitPress = tap({ value: unitScale, disabled: isSending, onPress: cycleUnit });

    const toggleMode = useCallback(() => {
        if (isSending || forceSend || chatBanned) return;
        setMode((current) => (current === 'send' ? 'request' : 'send'));
    }, [chatBanned, forceSend, isSending]);

    const closeRoute = useCallback(() => {
        if (!openRef.current) return;
        openRef.current = false;
        router.dismiss();
    }, []);

    const handleTransfer = useCallback(() => {
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

            void sendMessage(peerChatPK, makeReq(transferSats.toString()))
                .catch((err) => {
                    Alert.alert('Request failed', err?.message || 'Failed to send request.');
                })
                .finally(() => {
                    if (!openRef.current) return;
                    busyRef.current = false;
                    setIsSending(false);
                });
            return;
        }

        if (!peerWalletPK) {
            Alert.alert('Wallet unavailable', 'This person cannot receive money yet.');
            return;
        }

        busyRef.current = true;
        closeRoute();

        void sendMoneyWithSpark(peerWalletPK, Number(transferSats))
            .catch((err) => {
                Alert.alert('Send failed', err?.message || 'Failed to send money.');
            })
            .finally(() => {
                if (!openRef.current) return;
                busyRef.current = false;
                setIsSending(false);
            });
    }, [actionDisabled, closeRoute, mode, peerChatPK, peerWalletPK, sendMessage, sendMoneyWithSpark, transferSats]);

    useEffect(() => {
        if (!autoSend || !forceSend || !preset || autoSendRef.current || !canSend || isSending) {
            return;
        }

        autoSendRef.current = true;
        handleTransfer();
    }, [autoSend, canSend, forceSend, handleTransfer, isSending, preset]);

    return (
        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 32, justifyContent: 'space-between', gap: 16 }}>
            <View style={{ flex: 1, justifyContent: 'center', gap: preset ? 0 : 16 }}>
                {preset ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, width: '100%' }}>
                        <Avatar source={avatar} size={64} />
                        <Text numberOfLines={1} adjustsFontSizeToFit style={{ flexShrink: 1, fontSize: 64, fontWeight: '900', color: theme.foreground }}>
                            {amountText}
                        </Text>
                    </View>
                ) : (
                    <>
                        <View style={{ alignItems: 'center' }}>
                            <Avatar source={avatar} size={64} />
                        </View>
                        <GlassField disabled={isSending} style={{ paddingHorizontal: 16 }}>
                            <TextInput
                                ref={inputRef}
                                value={amount}
                                placeholder={unit === 'sats' ? '0000' : '0.00'}
                                placeholderTextColor={theme.muted}
                                keyboardType="numeric"
                                onChangeText={setAmount}
                                editable={!isSending}
                                style={{ flex: 1, fontSize: 24, fontWeight: '900', color: theme.foreground, paddingVertical: 10 }}
                                keyboardAppearance={isDark ? 'dark' : 'light'}
                            />
                            <Pressable {...unitPress} hitSlop={8} disabled={isSending}>
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
                {!forceSend ? <GlassIcon icon={modeIcon} iconSize={32} onPress={toggleMode} disabled={isSending || chatBanned} /> : null}
                <GlassButton onPress={handleTransfer} label={actionLabel} accent disabled={actionDisabled} pressableStyle={{ flex: 1 }} />
            </View>
        </View>
    );
}
