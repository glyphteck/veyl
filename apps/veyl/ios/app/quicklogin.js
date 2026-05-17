import { useEffect, useState } from 'react';
import { Animated as RNAnimated, FlatList, Pressable, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useRouter } from 'expo-router';

import Avatar, { AvatarAdornment, getAvatarAdornmentMetrics } from '@/components/avatar';
import { forgetQuickLoginAccount, listQuickLoginAccounts, requestQuickLogin } from '@/lib/quicklogin';
import { useTap } from '@/lib/tap';
import { useTheme } from '@/providers/themeprovider';

const INLINE_ACCOUNT_LIMIT = 2;
const QUICK_AVATAR_SIZE = 72;
const QUICK_CELL_PAD_TOP = 10;
const QUICK_CELL_PAD_BOTTOM = 0;
const QUICK_LABEL_MARGIN_TOP = 6;
const QUICK_LABEL_LINE_HEIGHT = 18;
const QUICK_CELL_HEIGHT = QUICK_CELL_PAD_TOP + QUICK_AVATAR_SIZE + QUICK_LABEL_MARGIN_TOP + QUICK_LABEL_LINE_HEIGHT + QUICK_CELL_PAD_BOTTOM;
const QUICK_MAX_ROWS = 4;
const QUICK_LIST_PAD_TOP = 24;
const QUICK_LIST_PAD_BOTTOM = 32;
const QUICK_REMOVE_METRICS = getAvatarAdornmentMetrics(QUICK_AVATAR_SIZE, { type: 'action' });
const QUICK_REMOVE_MASKS = [QUICK_REMOVE_METRICS];

function truncateLabel(label, max = 8) {
    if (!label || label.length <= max) return label || '';
    return `${label.slice(0, max)}...`;
}

function overflowAccounts(accounts) {
    return (accounts || []).slice(INLINE_ACCOUNT_LIMIT);
}

function QuickLoginCell({ account, disabled = false, onPress, onForget }) {
    const { theme } = useTheme();
    const press = useTap({ disabled, onPress, scale: 0.9 });
    const label = truncateLabel(account.username ? `@${account.username}` : 'account');

    return (
        <View style={{ width: '33.333%', alignItems: 'center', paddingTop: QUICK_CELL_PAD_TOP, paddingBottom: QUICK_CELL_PAD_BOTTOM }}>
            <View style={{ width: QUICK_AVATAR_SIZE, alignItems: 'center' }}>
                <Pressable {...press.props} disabled={disabled} style={{ alignItems: 'center' }}>
                    <RNAnimated.View style={{ alignItems: 'center', transform: [{ scale: press.scale }] }}>
                        <Avatar pointerEvents="none" source={account.avatar ? { uri: account.avatar } : null} size={QUICK_AVATAR_SIZE} maskAdornments={QUICK_REMOVE_MASKS} bot={!!account.bot} />
                        <Text
                            numberOfLines={1}
                            style={{ marginTop: QUICK_LABEL_MARGIN_TOP, width: 86, textAlign: 'center', fontSize: 14, lineHeight: QUICK_LABEL_LINE_HEIGHT, fontWeight: '700', color: theme.foreground }}
                        >
                            {label}
                        </Text>
                    </RNAnimated.View>
                </Pressable>
                <AvatarAdornment metrics={QUICK_REMOVE_METRICS} icon={X} color={theme.foreground} iconColor={theme.background} onPress={onForget} disabled={disabled} style={{ zIndex: 2 }} />
            </View>
        </View>
    );
}

export default function QuickLogin() {
    const router = useRouter();
    const [accounts, setAccounts] = useState([]);
    const [authState, setAuthState] = useState('idle');
    const isBusy = authState !== 'idle';
    const rowCount = Math.ceil(accounts.length / 3);
    const scrollNeeded = rowCount > QUICK_MAX_ROWS;
    const visibleRows = Math.min(rowCount, QUICK_MAX_ROWS);
    const bottomPadding = scrollNeeded ? QUICK_LIST_PAD_BOTTOM : 0;
    const maxHeight = QUICK_LIST_PAD_TOP + QUICK_MAX_ROWS * QUICK_CELL_HEIGHT;
    const listHeight = QUICK_LIST_PAD_TOP + visibleRows * QUICK_CELL_HEIGHT;

    useEffect(() => {
        let cancelled = false;
        listQuickLoginAccounts()
            .then((nextAccounts) => {
                if (!cancelled) setAccounts(overflowAccounts(nextAccounts));
            })
            .catch(() => {
                if (!cancelled) setAccounts([]);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const handleLogin = async (uid) => {
        if (authState !== 'idle' || !uid) return;

        setAuthState('preparing');
        router.dismiss();
        setTimeout(() => requestQuickLogin(uid), 160);
    };

    const handleForgetAccount = async (uid) => {
        if (authState !== 'idle' || !uid) return;
        setAccounts((current) => {
            const next = current.filter((account) => account.uid !== uid);
            if (!next.length) {
                requestAnimationFrame(() => router.dismiss());
            }
            return next;
        });
        try {
            await forgetQuickLoginAccount(uid);
        } catch (err) {
            console.warn('failed to forget quick login account', err);
        }
    };

    return (
        <FlatList
            data={accounts}
            keyExtractor={(account) => account.uid}
            renderItem={({ item }) => <QuickLoginCell account={item} disabled={isBusy} onPress={() => handleLogin(item.uid)} onForget={() => handleForgetAccount(item.uid)} />}
            numColumns={3}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            scrollEnabled={scrollNeeded}
            bounces={scrollNeeded}
            alwaysBounceVertical={scrollNeeded}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            style={{ height: listHeight, maxHeight }}
            contentContainerStyle={{ paddingHorizontal: 12, paddingTop: QUICK_LIST_PAD_TOP, paddingBottom: bottomPadding }}
        />
    );
}
