import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleDollarSign, FileText, Ghost, KeyRound, Lock, LogOut, QrCode, ScanQrCode, Settings, Shield, Timer, Trash2, UserX } from 'lucide-react-native';
import { useIsFocused } from '@react-navigation/native';
import { useNavigation, useRouter } from 'expo-router';

import AvatarPicker from '@/components/avatarpicker';
import GlassHeader from '@/components/glass/glassheader';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import SearchInput from '@/components/search';
import { deleteAvatar, uploadAvatar } from '@/lib/avatarupload';
import { clearFaceIdPassword, FaceIdIcon } from '@/lib/faceid';
import { auth } from '@/lib/firebase';
import { clearMsgImageCache } from '@/lib/msgimagecache';
import { hasQuickLoginAccount } from '@/lib/quicklogin';
import { useTap } from '@/lib/tap';
import { logout } from '@/lib/useractions';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import { defaultSettings } from '@glyphteck/shared/settings';
import Constants from 'expo-constants';

const MONEY_FORMATS = ['btc', 'sats', 'usd'];
const MONEY_LABELS = {
    btc: '₿TC',
    sats: 'sats',
    usd: 'US$',
};
const AUTOLOCK_VALUES = [1, 5, 10, 15, 30, 60, 'never'];
const SEARCH_BAR_HEIGHT = 42;

function cloneSettings(settings) {
    return {
        ...defaultSettings,
        ...(settings || {}),
        autolock: {
            ...defaultSettings.autolock,
            ...(settings?.autolock || {}),
        },
    };
}

function buildPatch(next, prev) {
    const patch = {};
    const autolock = {};

    if (next.moneyFormat !== prev.moneyFormat) {
        patch.moneyFormat = next.moneyFormat;
    }
    if (next.ghostWallet !== prev.ghostWallet) {
        patch.ghostWallet = next.ghostWallet;
    }
    if (next.sendOnScan !== prev.sendOnScan) {
        patch.sendOnScan = next.sendOnScan;
    }
    if (next.confirmSend !== prev.confirmSend) {
        patch.confirmSend = next.confirmSend;
    }
    if (next.faceID !== prev.faceID) {
        patch.faceID = next.faceID;
    }
    if (next.glass !== prev.glass) {
        patch.glass = next.glass;
    }
    if (next.autolock.timer !== prev.autolock.timer) {
        autolock.timer = next.autolock.timer;
    }
    if (next.autolock.onBackground !== prev.autolock.onBackground) {
        autolock.onBackground = next.autolock.onBackground;
    }

    if (Object.keys(autolock).length > 0) {
        patch.autolock = autolock;
    }

    return patch;
}

function nextIn(list, value) {
    const index = list.indexOf(value);
    return list[(index + 1 + list.length) % list.length];
}

function timerLabel(value) {
    if (value === 'never') {
        return 'never';
    }

    return `${value}m`;
}

function formatCacheSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function SectionDivider() {
    const { theme } = useTheme();

    return (
        <View style={{ paddingVertical: 6 }}>
            <View style={{ height: 1, backgroundColor: theme.border }} />
        </View>
    );
}

function ValuePill({ label, destructive = false }) {
    const { theme } = useTheme();
    const tintColor = destructive ? theme.destructive : theme.foreground;
    const color = theme.background;

    return (
        <GlassView glassEffectStyle="clear" tintColor={tintColor} pointerEvents="none" style={{ borderRadius: 999, width: 64, alignItems: 'center', paddingVertical: 8 }}>
            <Text style={{ color, fontSize: 14, fontWeight: '900' }}>{label}</Text>
        </GlassView>
    );
}

function Row({ icon, left, label, description, onPress, color, right, animateRight = false, disabled = false }) {
    const { theme } = useTheme();
    const tap = useTap({ onPress, disabled, drift: 1 });
    const iconColor = color || theme.foreground;
    const leftNode = left || <Icon icon={icon} size={26} color={iconColor} />;

    return (
        <Pressable {...tap.props} disabled={disabled}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}>
                <Animated.View style={{ transform: [{ scale: tap.scale }] }}>
                    {leftNode}
                </Animated.View>
                <View style={{ flex: 1, gap: description ? 2 : 0 }}>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: iconColor }}>{label}</Text>
                    {typeof description === 'string' ? <Text style={{ fontSize: 13, fontWeight: '500', lineHeight: 17, color: theme.muted }}>{description}</Text> : description || null}
                </View>
                {right ? (
                    <View style={{ alignSelf: 'center', alignItems: 'center', justifyContent: 'center' }}>
                        {animateRight ? <Animated.View style={{ transform: [{ scale: tap.scale }] }}>{right}</Animated.View> : right}
                    </View>
                ) : null}
            </View>
        </Pressable>
    );
}

function ClearCacheRow({ localCache, disabled = false, focused = true }) {
    const { theme } = useTheme();
    const [cacheSize, setCacheSize] = useState(0);
    const mountedRef = useRef(true);
    const clearingRef = useRef(false);
    const refreshRef = useRef(0);

    useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const refreshCacheSize = useCallback(async () => {
        const requestId = refreshRef.current + 1;
        refreshRef.current = requestId;
        const vaultSize = await (localCache?.estimateSize?.() || Promise.resolve(0));
        if (mountedRef.current && refreshRef.current === requestId) {
            setCacheSize(Number(vaultSize) || 0);
        }
    }, [localCache]);

    useEffect(() => {
        if (!focused) return;
        void refreshCacheSize().catch(() => {});
    }, [focused, refreshCacheSize]);

    const handleClearCache = useCallback(async () => {
        if (clearingRef.current) return;
        clearingRef.current = true;
        try {
            await Promise.all([localCache?.clear?.() || Promise.resolve(), clearMsgImageCache()]);
            if (mountedRef.current) {
                setCacheSize(0);
            }
        } catch (err) {
            console.warn('failed to clear local cache', err);
        } finally {
            clearingRef.current = false;
        }
    }, [localCache]);

    return (
        <Row
            left={<Icon icon={Trash2} size={26} color={theme.foreground} />}
            label="clear cache"
            onPress={handleClearCache}
            right={<Text style={{ fontSize: 16, fontWeight: '800', color: theme.foreground }}>{formatCacheSize(cacheSize)}</Text>}
            disabled={disabled || !localCache}
        />
    );
}

function SettingsHeader({ value, onChangeText, onClear, onLayout, disabled = false }) {
    const { theme } = useTheme();
    const router = useRouter();
    const routeLockRef = useRef(false);
    const routeLockTimerRef = useRef(null);
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

    useEffect(() => {
        return () => {
            if (routeLockTimerRef.current) clearTimeout(routeLockTimerRef.current);
        };
    }, []);

    const qrFeedback = useTap({
        disabled,
        onPress: () => {
            if (!lockRoute()) return;
            router.push('/userscan');
        },
    });

    return (
        <GlassHeader onLayout={onLayout} contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <SearchInput
                value={value}
                onChangeText={onChangeText}
                onClear={onClear}
                placeholder="search settings"
                glassEffectStyle="regular"
                tintColor={theme.background}
                style={{
                    flex: 1,
                    zIndex: 1,
                    height: SEARCH_BAR_HEIGHT,
                }}
            />
            <Pressable {...qrFeedback.props} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }} disabled={disabled}>
                <Animated.View style={{ opacity: disabled ? 0.45 : 1, transform: [{ scale: qrFeedback.scale }] }}>
                    <Icon icon={QrCode} size={28} color={theme.foreground} />
                </Animated.View>
            </Pressable>
        </GlassHeader>
    );
}

function AccountBlock({ disabled = false }) {
    const { theme } = useTheme();
    const { avatar, uid, username, avatarBanned, refetchAvatar, clearAvatar } = useUser();
    const [localAvatar, setLocalAvatar] = useState(null);
    const [avatarHidden, setAvatarHidden] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isRemoving, setIsRemoving] = useState(false);
    const effectiveUid = uid || auth.currentUser?.uid;
    const avatarSource = avatarHidden ? null : localAvatar ? { uri: localAvatar } : avatar ? { uri: avatar } : null;
    const isAvatarBusy = isUploading || isRemoving;
    const canRemoveAvatar = !!avatarSource && !avatarBanned && !isAvatarBusy && !disabled;

    const handlePickAvatar = useCallback(
        async (asset) => {
            if (disabled || avatarBanned || isAvatarBusy) return;
            if (!effectiveUid) {
                Alert.alert('Not ready', 'Your profile is still loading. Please try again in a moment.');
                return;
            }
            try {
                setAvatarHidden(false);
                setLocalAvatar(asset.uri);
                setIsUploading(true);

                await uploadAvatar({
                    uid: effectiveUid,
                    uri: asset.uri,
                    mimeType: asset.mimeType,
                });
                await refetchAvatar({ optimistic: true });
            } catch (err) {
                console.warn('avatar upload failed', err);
                setLocalAvatar(null);
            } finally {
                setIsUploading(false);
            }
        },
        [avatarBanned, disabled, effectiveUid, isAvatarBusy, refetchAvatar]
    );

    const handleRemoveAvatar = useCallback(async () => {
        if (disabled || isAvatarBusy || !canRemoveAvatar) return;
        if (!effectiveUid) {
            Alert.alert('Not ready', 'Your profile is still loading. Please try again in a moment.');
            return;
        }

        setAvatarHidden(true);
        setLocalAvatar(null);
        try {
            setIsRemoving(true);
            await deleteAvatar({ uid: effectiveUid });
            clearAvatar?.();
        } catch (err) {
            console.warn('avatar delete failed', err);
            setAvatarHidden(false);
        } finally {
            setIsRemoving(false);
        }
    }, [canRemoveAvatar, clearAvatar, disabled, effectiveUid, isAvatarBusy]);

    return (
        <View style={{ alignItems: 'center', paddingHorizontal: 16, paddingTop: 26, paddingBottom: 52, gap: 12 }}>
            <AvatarPicker
                size={140}
                disabled={disabled || isAvatarBusy || avatarBanned}
                onPick={handlePickAvatar}
                onRemove={handleRemoveAvatar}
                removeDisabled={!canRemoveAvatar}
                showRemove={canRemoveAvatar}
                source={avatarSource}
            />
            <Text numberOfLines={1} adjustsFontSizeToFit style={{ maxWidth: '100%', color: theme.foreground, fontSize: 28, fontWeight: '900' }}>
                {username ? `@${username}` : '@'}
            </Text>
        </View>
    );
}

export default function SettingsScreen() {
    const { theme } = useTheme();
    const navigation = useNavigation();
    const router = useRouter();
    const isFocused = useIsFocused();
    const insets = useSafeAreaInsets();
    const user = useUser();
    const { encSeed, localCache } = useVault();
    const [headerHeight, setHeaderHeight] = useState(0);
    const [settingSearch, setSettingSearch] = useState('');
    const [isLoggingOut, setIsLoggingOut] = useState(false);

    const serverSettings = useMemo(() => cloneSettings(user.settings), [user.settings]);
    const [settings, setSettings] = useState(serverSettings);
    const settingsRef = useRef(settings);
    const hasChangesRef = useRef(false);
    const savingRef = useRef(false);
    const openRef = useRef(true);

    useEffect(() => {
        return () => {
            openRef.current = false;
        };
    }, []);

    useEffect(() => {
        settingsRef.current = settings;
    }, [settings]);

    useEffect(() => {
        if (!user.settingsReady) return;
        settingsRef.current = serverSettings;
        hasChangesRef.current = false;
        setSettings(serverSettings);
    }, [serverSettings, user.settingsReady]);

    const applySettings = useCallback((update) => {
        setSettings((current) => {
            const base = cloneSettings(current);
            const rawNext = typeof update === 'function' ? update(base) : { ...base, ...update };
            const nextSettings = cloneSettings(rawNext);
            settingsRef.current = nextSettings;
            hasChangesRef.current = true;
            return nextSettings;
        });
    }, []);

    const moneyFormat = settings.moneyFormat;
    const ghostWallet = settings.ghostWallet === true;
    const sendOnScan = settings.sendOnScan === true;
    const faceIDEnabled = settings.faceID === true;
    const autolock = settings.autolock;
    const lockOnBackground = autolock.onBackground === true;

    const cycleMoneyFormat = useCallback(() => {
        applySettings((current) => ({
            ...current,
            moneyFormat: nextIn(MONEY_FORMATS, current.moneyFormat),
        }));
    }, [applySettings]);

    const cycleAutolockTimer = useCallback(() => {
        applySettings((current) => ({
            ...current,
            autolock: {
                ...current.autolock,
                timer: nextIn(AUTOLOCK_VALUES, current.autolock.timer),
            },
        }));
    }, [applySettings]);

    const handleSendOnScan = useCallback(
        (value) => {
            applySettings((current) => ({ ...current, sendOnScan: typeof value === 'boolean' ? value : !current.sendOnScan }));
        },
        [applySettings]
    );

    const handleGhostWallet = useCallback(
        (value) => {
            applySettings((current) => ({ ...current, ghostWallet: typeof value === 'boolean' ? value : !current.ghostWallet }));
        },
        [applySettings]
    );

    const handleLockOnBackground = useCallback(
        (value) => {
            applySettings((current) => ({
                ...current,
                autolock: {
                    ...current.autolock,
                    onBackground: typeof value === 'boolean' ? value : !current.autolock.onBackground,
                },
            }));
        },
        [applySettings]
    );

    const handleFaceIDToggle = useCallback(
        (value) => {
            applySettings((current) => ({ ...current, faceID: typeof value === 'boolean' ? value : !current.faceID }));
        },
        [applySettings]
    );

    const saveSettings = useCallback(async () => {
        if (!user.settingsReady || !hasChangesRef.current || savingRef.current) return;
        savingRef.current = true;
        const payload = cloneSettings(settingsRef.current);
        const patch = buildPatch(payload, serverSettings);

        try {
            if (Object.keys(patch).length === 0) {
                hasChangesRef.current = false;
                return;
            }

            await user.updateSettings(patch);

            if (patch.faceID === false && user.uid) {
                const cleared = await clearFaceIdPassword(user.uid).catch((err) => {
                    console.warn('failed to clear face id password', err);
                    return false;
                });

                if (!cleared) {
                    console.warn('failed to clear face id password');
                }
            }

            hasChangesRef.current = false;
        } catch (err) {
            console.warn('failed to update settings', err);
        } finally {
            savingRef.current = false;
        }
    }, [serverSettings, user.settingsReady, user.uid, user.updateSettings]);

    useEffect(() => {
        const appSub = AppState.addEventListener('change', (nextState) => {
            if (nextState !== 'active') {
                void saveSettings();
            }
        });
        const beforeRemoveSub = navigation.addListener('beforeRemove', () => {
            void saveSettings();
        });
        const blurSub = navigation.addListener('blur', () => {
            void saveSettings();
        });

        return () => {
            appSub?.remove?.();
            beforeRemoveSub?.();
            blurSub?.();
        };
    }, [navigation, saveSettings]);

    const openLegal = useCallback(() => {
        router.push('/legal');
    }, [router]);

    const openCommunity = useCallback(() => {
        router.push('/community');
    }, [router]);

    const openBlocked = useCallback(() => {
        router.push('/blocked');
    }, [router]);

    const openExportWallet = useCallback(() => {
        router.push('/exportwallet');
    }, [router]);

    const openPermissions = useCallback(() => {
        void Linking.openSettings();
    }, []);

    const performLogout = async (remember) => {
        if (isLoggingOut) return;
        setIsLoggingOut(true);
        try {
            await saveSettings();
            await logout({ remember, account: user });
        } catch (err) {
            console.warn('logout failed', err);
            if (openRef.current) {
                setIsLoggingOut(false);
            }
        }
    };

    const handleLogout = async () => {
        if (isLoggingOut) return;
        if (await hasQuickLoginAccount(user.uid)) {
            await performLogout(true);
            return;
        }
        Alert.alert('remember account?', 'login faster next time', [
            { text: 'no thanks', style: 'cancel', onPress: () => performLogout(false) },
            { text: 'remember', onPress: () => performLogout(true) },
        ]);
    };

    const openDeleteAccount = useCallback(() => {
        router.push('/deleteaccount');
    }, [router]);

    const handleDeleteAccount = useCallback(() => {
        if (!user.uid || isLoggingOut) return;
        openDeleteAccount();
    }, [isLoggingOut, openDeleteAccount, user.uid]);

    const isBusy = isLoggingOut;
    const switchProps = {
        trackColor: { false: theme.border, true: theme.active },
        thumbColor: theme.background,
        disabled: isBusy,
    };
    const autoSendSwitchProps = {
        ...switchProps,
        trackColor: { false: theme.border, true: theme.destructive },
    };

    const appVersion = Constants.expoConfig?.version || '';
    const search = settingSearch.trim().toLowerCase();
    const isSearching = !!search;
    const autoSendDescription = (
        <Text style={{ fontSize: 13, fontWeight: '500', lineHeight: 17, color: theme.muted }}>
            <Text style={{ color: theme.destructive }}>send immediately</Text> when the qr already includes an amount.
        </Text>
    );
    const match = (...terms) => !search || terms.some((term) => String(term || '').toLowerCase().includes(search));
    const showMoney = match('display currency', 'money format', 'btc sats usd');
    const showGhostWallet = match('ghost wallet', 'wallet privacy', 'private bitcoin activity');
    const showAutoSend = match('auto send on scan', 'qr payment behaviour', 'send immediately');
    const showLockTimer = match('lock timeout', 'autolock timer');
    const showLockBackground = match('lock on app background', 'background lock');
    const showFaceID = match('use face id', 'biometric unlock');
    const showCache = match('clear cache', 'local cache storage');
    const showPermissions = match('manage permissions', 'system settings');
    const showLegal = match('legal support', 'terms privacy help');
    const showCommunity = match('community rules', 'rules');
    const showBlocked = match('blocked users', 'block list');
    const showExportWallet = match('export wallet', 'seed backup key');
    const showLogout = match('logout', 'sign out');
    const showDeleteAccount = match('delete account', 'remove account');
    const paymentRows = showMoney || showGhostWallet || showAutoSend;
    const lockRows = showLockTimer || showLockBackground;
    const deviceRows = showFaceID;
    const cacheRows = showCache;
    const supportRows = showPermissions || showLegal || showCommunity;
    const accountRows = showBlocked || showExportWallet || showLogout;
    const dangerRows = showDeleteAccount;
    const hasSettingsRows = paymentRows || lockRows || deviceRows || cacheRows || supportRows || accountRows || dangerRows;

    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <ScrollView
                contentContainerStyle={{
                    paddingTop: headerHeight,
                    paddingBottom: insets.bottom + 56,
                }}
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                bounces
                alwaysBounceVertical
                directionalLockEnabled
                alwaysBounceHorizontal={false}
            >
                {!isSearching ? (
                    <>
                        <AccountBlock disabled={isBusy} />
                        <Text style={{ paddingHorizontal: 16, paddingBottom: 8, color: theme.foreground, fontSize: 26, fontWeight: '900' }}>settings</Text>
                        {hasSettingsRows ? <SectionDivider /> : null}
                    </>
                ) : null}

                {paymentRows ? (
                    <>
                        {showMoney ? <Row icon={CircleDollarSign} label="display currency" onPress={cycleMoneyFormat} right={<ValuePill label={MONEY_LABELS[moneyFormat]} />} animateRight disabled={isBusy} /> : null}
                        {showGhostWallet ? (
                            <Row
                                icon={Ghost}
                                label="ghost wallet"
                                description="hide bitcoin activity from public lookups."
                                onPress={() => handleGhostWallet(!ghostWallet)}
                                right={<Switch value={ghostWallet} onValueChange={handleGhostWallet} {...switchProps} />}
                                disabled={isBusy}
                            />
                        ) : null}
                        {showAutoSend ? (
                            <Row
                                icon={ScanQrCode}
                                label="auto send on scan"
                                description={autoSendDescription}
                                onPress={() => handleSendOnScan(!sendOnScan)}
                                right={<Switch value={sendOnScan} onValueChange={handleSendOnScan} {...autoSendSwitchProps} />}
                                disabled={isBusy}
                            />
                        ) : null}
                    </>
                ) : null}

                {paymentRows && (lockRows || deviceRows || cacheRows || supportRows || accountRows || dangerRows) ? <SectionDivider /> : null}

                {lockRows ? (
                    <>
                        {showLockTimer ? <Row icon={Timer} label="lock timeout" onPress={cycleAutolockTimer} right={<ValuePill label={timerLabel(autolock.timer)} />} animateRight disabled={isBusy} /> : null}
                        {showLockBackground ? (
                            <Row
                                icon={Lock}
                                label="lock on app background"
                                onPress={() => handleLockOnBackground(!lockOnBackground)}
                                right={<Switch value={lockOnBackground} onValueChange={handleLockOnBackground} {...switchProps} />}
                                disabled={isBusy}
                            />
                        ) : null}
                    </>
                ) : null}

                {lockRows && (deviceRows || cacheRows || supportRows || accountRows || dangerRows) ? <SectionDivider /> : null}

                {deviceRows ? (
                    <Row
                        icon={FaceIdIcon}
                        label="use Face ID"
                        description="you may need to unlock with your password one more time before Face ID is ready on this device."
                        onPress={() => handleFaceIDToggle(!faceIDEnabled)}
                        right={<Switch value={faceIDEnabled} onValueChange={handleFaceIDToggle} {...switchProps} />}
                        disabled={isBusy}
                    />
                ) : null}

                {deviceRows && (cacheRows || supportRows || accountRows || dangerRows) ? <SectionDivider /> : null}

                {cacheRows ? <ClearCacheRow localCache={localCache} disabled={isBusy} focused={isFocused} /> : null}

                {cacheRows && (supportRows || accountRows || dangerRows) ? <SectionDivider /> : null}

                {supportRows ? (
                    <>
                        {showPermissions ? <Row icon={Settings} label="manage permissions" onPress={openPermissions} disabled={isBusy} /> : null}
                        {showLegal ? <Row icon={FileText} label="legal & support" onPress={openLegal} disabled={isBusy} /> : null}
                        {showCommunity ? <Row icon={Shield} label="community rules" onPress={openCommunity} disabled={isBusy} /> : null}
                    </>
                ) : null}

                {supportRows && (accountRows || dangerRows) ? <SectionDivider /> : null}

                {accountRows ? (
                    <>
                        {showBlocked ? <Row icon={UserX} label="blocked users" onPress={openBlocked} disabled={isBusy} /> : null}
                        {showExportWallet ? <Row icon={KeyRound} label="export wallet" onPress={openExportWallet} disabled={isBusy || !encSeed} /> : null}
                        {showLogout ? (
                            <Row
                                left={isLoggingOut ? <ActivityIndicator color={theme.destructive} /> : <Icon icon={LogOut} size={26} color={theme.destructive} />}
                                label="logout"
                                onPress={handleLogout}
                                color={theme.destructive}
                                disabled={isBusy}
                            />
                        ) : null}
                    </>
                ) : null}

                {accountRows && dangerRows ? <SectionDivider /> : null}

                {dangerRows ? (
                    <Row
                        icon={Trash2}
                        label="delete account"
                        description="export or empty the wallet first. deleting can burn remaining bitcoin and chats forever."
                        onPress={handleDeleteAccount}
                        color={theme.destructive}
                        disabled={isBusy}
                    />
                ) : null}
                {!isSearching && dangerRows && appVersion ? <SectionDivider /> : null}
                {!hasSettingsRows ? (
                    <View style={{ alignItems: 'center', paddingHorizontal: 16, paddingVertical: 22 }}>
                        <Text style={{ color: theme.muted, fontSize: 16, fontWeight: '800' }}>no settings found</Text>
                    </View>
                ) : null}
                {!isSearching && appVersion ? (
                    <View style={{ alignItems: 'center', paddingTop: 14, paddingBottom: 8 }}>
                        <Text style={{ fontSize: 16, fontWeight: '900', color: theme.foreground }}>v{appVersion}</Text>
                    </View>
                ) : null}
            </ScrollView>

            <SettingsHeader value={settingSearch} onChangeText={setSettingSearch} onClear={() => setSettingSearch('')} onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)} disabled={isBusy} />
        </View>
    );
}
