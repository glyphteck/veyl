import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
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
import { makeReq } from '@glyphteck/shared/chat/messages';
import { formatUserDisplay, renderMoney, satsInABitcoin, toDisplay, toSats } from '@glyphteck/shared/utils';

const UNITS = ['sats', 'btc', 'usd'];
const MAX_REQUEST_AMOUNT = satsInABitcoin * 100000n;

function pick(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value[0] || '';
    return '';
}

function flag(value) {
    const raw = pick(value).trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

export default function TransferScreen() {
    const { theme, isDark } = useTheme();
    const { settings, walletPK: ownWalletPK, chatBanned } = useUser();
    const bitcoin = useBitcoin();
    const { sendMoneyWithSpark, balance } = useWallet();
    const { sendMessage } = useChat() || {};
    const { peers, addPeer } = usePeer() || {};
    const params = useLocalSearchParams();

    const uid = pick(params?.uid).trim();
    const walletPK = pick(params?.walletPK).trim();
    const rawAmount = pick(params?.amount).trim();
    const presetMode = pick(params?.mode).trim().toLowerCase();
    const forceSend = flag(params?.send);
    const autoSend = flag(params?.auto);
    const price = bitcoin?.price ?? 100000;
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

    const balanceSats = useMemo(() => {
        if (balance == null) return 0n;
        try {
            return BigInt(Math.floor(Number(balance)));
        } catch {
            return 0n;
        }
    }, [balance]);

    const knownPeer = useMemo(() => {
        if (!Array.isArray(peers)) return null;
        if (uid) {
            const byUid = peers.find((peer) => peer?.uid === uid);
            if (byUid) return byUid;
        }
        if (!walletPK) return null;
        return peers.find((peer) => peer?.walletPK === walletPK) ?? null;
    }, [peers, uid, walletPK]);

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

    const maxSats = mode === 'request' ? MAX_REQUEST_AMOUNT : balanceSats;
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
        const i = UNITS.indexOf(unit);
        const next = UNITS[(i + 1) % UNITS.length];
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

    const closeRoute = useCallback(async () => {
        inputRef.current?.blur?.();
        Keyboard.dismiss();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (!openRef.current) return;
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
            setIsSending(true);
            void closeRoute();

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
        setIsSending(true);
        void closeRoute();

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
