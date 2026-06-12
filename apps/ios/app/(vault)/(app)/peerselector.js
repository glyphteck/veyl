import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, Share, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { ArrowDownLeft, ArrowUpRight, MessageCircle, Search } from 'lucide-react-native';
import { mergeProfiles } from '@veyl/shared/search/merge';
import { yieldToUi } from '@veyl/shared/utils/async';
import { MONEY_UNITS, toDisplay, toSats } from '@veyl/shared/money';
import { formatUserDisplay } from '@veyl/shared/profile';
import { makeReq } from '@veyl/shared/chat/messages';
import { invite, makeInviteLink } from '@veyl/shared/invite';
import { BTC_PRICE_FALLBACK, REQUEST_MONEY_MAX_SATS } from '@veyl/shared/config';
import { availableBalanceSats } from '@veyl/shared/wallet/balance';

import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { usePeer } from '@/providers/peerprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import { useChat } from '@/providers/chatprovider';
import { useSearch } from '@/lib/search/usesearch';
import EmptyState from '@/components/emptystate';
import GlassButton from '@/components/glass/glassbutton';
import GlassField from '@/components/glass/glassfield';
import GlassIcon from '@/components/glass/glassicon';
import PeerPicker, { samePeer } from '@/components/peerpicker';
import { tap } from '@/lib/tap';
import { useRouteLock } from '@/lib/navigation/routelock';

export default function PeerSelectorScreen() {
    const { theme } = useTheme();
    const { peers, recentPeers } = usePeer() || {};
    const { settings, username, chatPK, chatBanned } = useUser();
    const bitcoin = useBitcoin();
    const { sendMoneyWithSpark, balance } = useWallet();
    const { sendMessage, selectPeerChat } = useChat();
    const { searching, results, query, search: runSearch, clearSearch } = useSearch('profiles');
    const router = useRouter();

    const searchInputRef = useRef(null);
    const amountInputRef = useRef(null);
    const activePeer = useRef(null);
    const openRef = useRef(true);
    const busyRef = useRef(false);
    const { lockRoute } = useRouteLock();

    const [selectedPeer, setSelectedPeer] = useState(null);
    const [footerPeer, setFooterPeer] = useState(null);
    const [amount, setAmount] = useState('');
    const [inputUnit, setInputUnit] = useState(settings?.moneyFormat || 'sats');
    const [overlayVisible, setOverlayVisible] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [search, setSearch] = useState('');
    const [mode, setMode] = useState('send');

    const cycleScale = useSharedValue(1);

    useEffect(() => {
        return () => {
            openRef.current = false;
            clearSearch();
        };
    }, [clearSearch]);

    useEffect(() => {
        if (chatBanned) {
            setMode('send');
        }
    }, [chatBanned]);

    const pickPeer = useCallback((peer) => {
        activePeer.current = peer;
        setSelectedPeer(peer);
    }, []);

    const resetOverlay = useCallback(() => {
        setOverlayVisible(false);
        pickPeer(null);
        setFooterPeer(null);
        setAmount('');
        setInputUnit(settings?.moneyFormat || 'sats');
    }, [pickPeer, settings?.moneyFormat]);

    const handleInvite = useCallback(async () => {
        if (chatBanned) {
            Alert.alert('Chat unavailable', 'You cannot create a chat invite right now.');
            return;
        }
        if (!username) {
            Alert.alert('Invite unavailable', 'Your profile is still loading.');
            return;
        }

        const link = makeInviteLink({ kind: invite.chat, from: username });
        if (!link) {
            Alert.alert('Invite unavailable', 'Could not create an invite link.');
            return;
        }

        searchInputRef.current?.blur();
        amountInputRef.current?.blur();
        Keyboard.dismiss();
        resetOverlay();

        try {
            await Share.share({
                title: 'Chat on veyl',
                message: link,
                url: link,
            });
        } catch (error) {
            Alert.alert('Invite failed', error?.message || 'Could not open sharing.');
        }
    }, [chatBanned, resetOverlay, username]);

    const finishClose = useCallback(() => {
        if (activePeer.current) return;
        resetOverlay();
    }, [resetOverlay]);

    const handleSelectPeer = useCallback(
        (nextPeer) => {
            const current = activePeer.current;
            if (samePeer(current, nextPeer)) {
                pickPeer(null);
                searchInputRef.current?.blur();
                amountInputRef.current?.blur();
                return;
            }

            searchInputRef.current?.blur();
            setFooterPeer(nextPeer);
            pickPeer(nextPeer);
            setAmount('');
            setInputUnit(settings?.moneyFormat || 'sats');
            setOverlayVisible(true);
        },
        [pickPeer, settings?.moneyFormat]
    );

    const handleSearchChange = useCallback(
        (value) => {
            setSearch(value);
            runSearch(value);
        },
        [runSearch]
    );

    const handleClearSearch = useCallback(() => {
        setSearch('');
        clearSearch();
    }, [clearSearch]);

    const closeRoute = useCallback(async () => {
        searchInputRef.current?.blur?.();
        amountInputRef.current?.blur?.();
        Keyboard.dismiss();
        await yieldToUi();
        if (!openRef.current) return;
        router.dismiss();
    }, [router]);

    const cycleUnit = useCallback(() => {
        const price = bitcoin?.price ?? BTC_PRICE_FALLBACK;
        const idx = MONEY_UNITS.indexOf(inputUnit);
        const next = MONEY_UNITS[(idx + 1) % MONEY_UNITS.length];
        if (amount) {
            const sats = toSats(amount, inputUnit, price);
            setAmount(sats === 0n ? '' : toDisplay(sats, next, price));
        }
        setInputUnit(next);
    }, [amount, bitcoin?.price, inputUnit]);

    const validSats = useMemo(() => {
        if (!amount) return 0n;
        const price = bitcoin?.price ?? BTC_PRICE_FALLBACK;
        const max = mode === 'request' ? REQUEST_MONEY_MAX_SATS : availableBalanceSats(balance);
        try {
            const sats = toSats(amount, inputUnit, price);
            if (sats <= 0n || sats > max) return 0n;
            return sats;
        } catch {
            return 0n;
        }
    }, [amount, balance, bitcoin?.price, inputUnit, mode]);

    const filteredPeers = useMemo(() => {
        const list = Array.isArray(peers) ? peers : [];
        const recent = Array.isArray(recentPeers?.all) ? recentPeers.all : [];
        const requireWalletAndChat = (peer) => mode !== 'request' || (!!peer.walletPK && !!peer.chatPK);
        if (!search.trim()) return recent.filter(requireWalletAndChat);
        if (!query) return [];
        return mergeProfiles({
            local: list,
            remote: results || [],
            parsed: query,
            extraFilter: requireWalletAndChat,
        });
    }, [mode, peers, query, recentPeers?.all, results, search]);

    const handleOpenChat = useCallback(() => {
        if (chatBanned) return;
        if (!selectedPeer?.chatPK || !chatPK) return;
        if (!lockRoute()) return;
        void selectPeerChat?.(selectedPeer.chatPK);
        router.replace({ pathname: '/chat/[peerchatpk]', params: { peerchatpk: selectedPeer.chatPK } });
    }, [chatBanned, chatPK, lockRoute, router, selectPeerChat, selectedPeer]);

    const toggleMode = useCallback(() => {
        if (isSending || chatBanned) return;
        setMode((current) => (current === 'send' ? 'request' : 'send'));
    }, [chatBanned, isSending]);

    const handleSend = useCallback(() => {
        if (isSending || validSats <= 0n || busyRef.current) return;

        if (mode === 'request') {
            const peerChatPK = selectedPeer?.chatPK;
            if (!peerChatPK) {
                Alert.alert('Chat unavailable', 'This person cannot receive requests yet.');
                return;
            }

            amountInputRef.current?.blur();
            busyRef.current = true;
            setIsSending(true);
            void closeRoute();

            const message = makeReq(validSats.toString());
            sendMessage(peerChatPK, message)
                .catch((error) => {
                    Alert.alert('Request failed', error?.message || 'Failed to send request.');
                })
                .finally(() => {
                    if (!openRef.current) return;
                    busyRef.current = false;
                    setIsSending(false);
                });
            return;
        }

        const receiverWalletPK = selectedPeer?.walletPK;
        if (!receiverWalletPK) {
            Alert.alert('Wallet unavailable', 'This person cannot receive money yet.');
            return;
        }

        amountInputRef.current?.blur();
        busyRef.current = true;
        setIsSending(true);
        void closeRoute();

        void sendMoneyWithSpark(receiverWalletPK, Number(validSats))
            .catch((error) => {
                Alert.alert('Send failed', error?.message || 'Failed to send.');
            })
            .finally(() => {
                if (!openRef.current) return;
                busyRef.current = false;
                setIsSending(false);
            });
    }, [closeRoute, isSending, mode, selectedPeer, sendMessage, sendMoneyWithSpark, validSats]);

    const cycleStyle = useAnimatedStyle(() => ({ transform: [{ scale: cycleScale.value }] }));
    const cyclePress = tap({ value: cycleScale, disabled: isSending, onPress: cycleUnit });
    const modeIcon = mode === 'request' ? ArrowDownLeft : ArrowUpRight;
    const displayPeer = selectedPeer || footerPeer;
    const footerInteractive = overlayVisible && !!selectedPeer && !isSending;
    const sendLabel =
        mode === 'request'
            ? isSending
                ? 'requesting...'
                : displayPeer
                  ? `request from ${formatUserDisplay(displayPeer, false)}`
                  : 'request'
            : isSending
              ? 'sending...'
              : displayPeer
                ? `send to ${formatUserDisplay(displayPeer, false)}`
                : 'send';
    const sendDisabled = !validSats || isSending || (mode === 'request' ? chatBanned || !displayPeer?.chatPK : !displayPeer?.walletPK);
    const amountPlaceholder = inputUnit === 'sats' ? '0000' : '0.00';

    return (
        <PeerPicker
            searchInputRef={searchInputRef}
            search={search}
            onSearchChange={handleSearchChange}
            onClearSearch={handleClearSearch}
            searching={searching}
            peers={filteredPeers}
            theme={theme}
            onInvitePress={handleInvite}
            onPeerPress={handleSelectPeer}
            isPeerSelected={(peer) => samePeer(selectedPeer, peer)}
            isPeerDisabled={(peer) => !peer?.walletPK && !peer?.chatPK}
            footerOpen={!!selectedPeer}
            footerInteractive={footerInteractive}
            footerScrollPeer={selectedPeer}
            onFooterHidden={finishClose}
            emptyState={
                searching ? (
                    <EmptyState busy title="searching..." />
                ) : search && !query ? (
                    <EmptyState icon={Search} title="type a username" />
                ) : search ? (
                    <EmptyState icon={Search} title="no matches" />
                ) : (
                    <EmptyState icon={MessageCircle} title="no recent friends" />
                )
            }
            footer={
                <>
                    <GlassField disabled={isSending} style={{ flex: 1, paddingHorizontal: 16 }}>
                        <TextInput
                            ref={amountInputRef}
                            value={amount}
                            placeholder={amountPlaceholder}
                            placeholderTextColor={theme.muted}
                            keyboardType="numeric"
                            onChangeText={setAmount}
                            editable={overlayVisible && !isSending}
                            style={{ flex: 1, fontSize: 24, fontWeight: '900', color: theme.foreground, paddingVertical: 10 }}
                        />
                        <Pressable {...cyclePress} hitSlop={8} disabled={isSending}>
                            <Animated.View style={[{ paddingLeft: 12, alignItems: 'center', justifyContent: 'center' }, cycleStyle]}>
                                {inputUnit === 'btc' && <Text style={{ fontSize: 24, fontWeight: '900', color: theme.muted }}>₿</Text>}
                                {inputUnit === 'usd' && <Text style={{ fontSize: 24, fontWeight: '900', color: theme.muted }}>$</Text>}
                                {inputUnit === 'sats' && <Text style={{ marginBottom: 2, fontSize: 24, fontWeight: '900', color: theme.muted }}>sats</Text>}
                            </Animated.View>
                        </Pressable>
                    </GlassField>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <GlassIcon icon={modeIcon} iconSize={32} onPress={toggleMode} disabled={isSending || chatBanned} />
                        <GlassButton onPress={handleSend} label={sendLabel} accent disabled={sendDisabled} pressableStyle={{ flex: 1 }} />
                        <GlassIcon icon={MessageCircle} onPress={handleOpenChat} disabled={!displayPeer?.chatPK || isSending || chatBanned} />
                    </View>
                </>
            }
        />
    );
}
