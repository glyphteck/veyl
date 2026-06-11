import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleDollarSign, FileText, KeyRound, Lock, LogOut, MessageCircle, QrCode, ScanQrCode, Settings, Shield, Timer, Trash2, UserX } from 'lucide-react-native';
import { useIsFocused, useNavigation, useRouter } from 'expo-router';

import AvatarPicker from '@/components/avatarpicker';
import GlassIcon from '@/components/glass/glassicon';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import { getMainMenuHeight } from '@/components/mainmenu';
import SearchInput from '@/components/search';
import { deleteAvatar, uploadAvatar } from '@/lib/avatarupload';
import { clearFaceIdPassword, FaceIdIcon } from '@/lib/faceid';
import { cloud } from '@/lib/cloud';
import { clearMsgImageCache } from '@/lib/chat/imagecache';
import { hasQuickLoginAccount } from '@/lib/user/quicklogin';
import { useRouteLock } from '@/lib/navigation/routelock';
import { useTap } from '@/lib/tap';
import { logout } from '@/lib/user/actions';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import { defaultSettings, PAYMENT_BEHAVIOR_SETTINGS_VISIBLE, SEND_ON_SCAN_ENABLED } from '@veyl/shared/settings';
import { lowerText } from '@veyl/shared/utils/text';
import { formatCacheSize } from '@veyl/shared/utils/display';
import Constants from 'expo-constants';

const MONEY_FORMATS = ['btc', 'sats', 'usd'];
const MONEY_LABELS = {
    btc: '₿TC',
    sats: 'sats',
    usd: 'US$',
};
const AUTOLOCK_VALUES = [1, 5, 10, 15, 30, 60, 'never'];
const SEARCH_ROW_HEIGHT = 56;
const SEARCH_TOP_GAP = 8;
const SEARCH_LIST_GAP = 2;

function cloneSettings(settings) {
    const next = {
        ...defaultSettings,
        ...(settings || {}),
        autolock: {
            ...defaultSettings.autolock,
            ...(settings?.autolock || {}),
        },
    };
    if (!SEND_ON_SCAN_ENABLED) {
        next.sendOnScan = false;
    }
    return next;
}

function buildPatch(next, prev) {
    const patch = {};
    const autolock = {};

    if (next.moneyFormat !== prev.moneyFormat) {
        patch.moneyFormat = next.moneyFormat;
    }
    if (next.showChatPreviews !== prev.showChatPreviews) {
        patch.showChatPreviews = next.showChatPreviews;
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

function SettingsHeader({ disabled = false, searchTop, value, onChangeText, onClear }) {
    const { theme } = useTheme();
    const router = useRouter();
    const { lockRoute } = useRouteLock();

    const openScan = useCallback(() => {
        if (!lockRoute()) return;
        router.push('/userscan');
    }, [lockRoute, router]);

    return (
        <View
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 16,
                position: 'absolute',
                top: searchTop,
                left: 0,
                right: 0,
                zIndex: 2,
            }}
        >
            <SearchInput
                value={value}
                onChangeText={onChangeText}
                onClear={onClear}
                placeholder="search settings"
                style={{
                    flex: 1,
                    zIndex: 1,
                }}
            />
            <GlassIcon icon={QrCode} onPress={openScan} disabled={disabled} size={56} iconSize={26} />
        </View>
    );
}

function AccountBlock({ disabled = false }) {
    const { theme } = useTheme();
    const { avatar, uid, username, avatarBanned, refetchAvatar, clearAvatar } = useUser();
    const [localAvatar, setLocalAvatar] = useState(null);
    const [avatarHidden, setAvatarHidden] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isRemoving, setIsRemoving] = useState(false);
    const effectiveUid = uid || cloud.auth.user?.uid;
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

                const uploaded = await uploadAvatar({
                    uid: effectiveUid,
                    uri: asset.uri,
                    mimeType: asset.mimeType,
                });
                await refetchAvatar({ version: uploaded?.version });
                setLocalAvatar(null);
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
        <View style={{ alignItems: 'center', paddingHorizontal: 16, paddingTop: 26, paddingBottom: 68, gap: 14 }}>
            <AvatarPicker
                size={140}
                disabled={disabled || isAvatarBusy || avatarBanned}
                onPick={handlePickAvatar}
                onRemove={handleRemoveAvatar}
                removeDisabled={!canRemoveAvatar}
                showRemove={canRemoveAvatar}
                source={avatarSource}
            />
            <Text numberOfLines={1} adjustsFontSizeToFit style={{ maxWidth: '100%', color: theme.foreground, fontSize: 34, lineHeight: 40, fontWeight: '900' }}>
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
    const { vault, localCache } = useVault();
    const [settingSearch, setSettingSearch] = useState('');
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const mainMenuHeight = getMainMenuHeight(insets.bottom);
    const searchTop = insets.top + SEARCH_TOP_GAP;
    const listTopSpace = searchTop + SEARCH_ROW_HEIGHT + SEARCH_LIST_GAP;

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
    const showChatPreviews = settings.showChatPreviews !== false;
    const sendOnScan = SEND_ON_SCAN_ENABLED && settings.sendOnScan === true;
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
            if (!SEND_ON_SCAN_ENABLED) return;
            applySettings((current) => ({ ...current, sendOnScan: typeof value === 'boolean' ? value : !current.sendOnScan }));
        },
        [applySettings]
    );

    const handleChatPreviews = useCallback(
        (value) => {
            applySettings((current) => ({ ...current, showChatPreviews: typeof value === 'boolean' ? value : current.showChatPreviews === false }));
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
    const search = lowerText(settingSearch);
    const isSearching = !!search;
    const autoSendDescription = (
        <Text style={{ fontSize: 13, fontWeight: '500', lineHeight: 17, color: theme.muted }}>
            <Text style={{ color: theme.destructive }}>send immediately</Text> when the qr already includes an amount.
        </Text>
    );
    const match = (...terms) => !search || terms.some((term) => lowerText(term).includes(search));
    const showMoney = match('display currency', 'money format', 'btc sats usd');
    const showChatPreviewSetting = match('chat previews', 'message previews', 'preview text');
    const showAutoSend = PAYMENT_BEHAVIOR_SETTINGS_VISIBLE && SEND_ON_SCAN_ENABLED && match('auto send on scan', 'qr payment behaviour', 'send immediately');
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
    const preferenceRows = showMoney || showChatPreviewSetting || showAutoSend;
    const lockRows = showLockTimer || showLockBackground;
    const deviceRows = showFaceID;
    const cacheRows = showCache;
    const supportRows = showPermissions || showLegal || showCommunity;
    const accountRows = showBlocked || showExportWallet || showLogout;
    const dangerRows = showDeleteAccount;
    const hasSettingsRows = preferenceRows || lockRows || deviceRows || cacheRows || supportRows || accountRows || dangerRows;

    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <ScrollView
                contentContainerStyle={{
                    paddingTop: listTopSpace,
                    paddingBottom: mainMenuHeight,
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

                {preferenceRows ? (
                    <>
                        {showMoney ? <Row icon={CircleDollarSign} label="display currency" onPress={cycleMoneyFormat} right={<ValuePill label={MONEY_LABELS[moneyFormat]} />} animateRight disabled={isBusy} /> : null}
                        {showChatPreviewSetting ? (
                            <Row
                                icon={MessageCircle}
                                label="chat previews"
                                onPress={() => handleChatPreviews(!showChatPreviews)}
                                right={<Switch value={showChatPreviews} onValueChange={handleChatPreviews} {...switchProps} />}
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

                {preferenceRows && (lockRows || deviceRows || cacheRows || supportRows || accountRows || dangerRows) ? <SectionDivider /> : null}

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
                        {showExportWallet ? <Row icon={KeyRound} label="export wallet" onPress={openExportWallet} disabled={isBusy || !vault} /> : null}
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
                        description="export or empty the wallet first. deleting can make remaining bitcoin and chats unrecoverable."
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
                    <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 14 }}>
                        <Text style={{ fontSize: 16, fontWeight: '900', color: theme.foreground }}>v{appVersion}</Text>
                    </View>
                ) : null}
            </ScrollView>

            <SettingsHeader value={settingSearch} onChangeText={setSettingSearch} onClear={() => setSettingSearch('')} searchTop={searchTop} disabled={isBusy} />
        </View>
    );
}
