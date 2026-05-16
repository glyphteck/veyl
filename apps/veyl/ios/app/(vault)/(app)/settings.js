import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, CircleDollarSign, FileText, KeyRound, Lock, LogOut, ScanQrCode, Settings, Shield, Timer, Trash2, UserX } from 'lucide-react-native';
import { useNavigation, useRouter } from 'expo-router';

import GlassFooter from '@/components/glass/glassfooter';
import GlassHeader from '@/components/glass/glassheader';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import { clearFaceIdPassword, FaceIdIcon } from '@/lib/faceid';
import { clearMsgImageCache } from '@/lib/msgimagecache';
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

function Row({ icon, left, label, description, onPress, color, right, disabled = false }) {
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
                {right ? <View style={{ alignSelf: 'center', alignItems: 'center', justifyContent: 'center' }}>{right}</View> : null}
            </View>
        </Pressable>
    );
}

function ClearCacheRow({ localCache, disabled = false }) {
    const { theme } = useTheme();
    const [cacheSize, setCacheSize] = useState(0);
    const mountedRef = useRef(true);
    const clearingRef = useRef(false);

    useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const refreshCacheSize = useCallback(async () => {
        const vaultSize = await (localCache?.estimateSize?.() || Promise.resolve(0));
        if (mountedRef.current) {
            setCacheSize(Number(vaultSize) || 0);
        }
    }, [localCache]);

    useEffect(() => {
        void refreshCacheSize().catch(() => {});
    }, [refreshCacheSize]);

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

export default function SettingsScreen() {
    const { theme } = useTheme();
    const navigation = useNavigation();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const user = useUser();
    const { encSeed, localCache } = useVault();
    const [headerHeight, setHeaderHeight] = useState(0);
    const [footerHeight, setFooterHeight] = useState(0);
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
        const navSub = navigation.addListener('beforeRemove', () => {
            void saveSettings();
        });

        return () => {
            appSub?.remove?.();
            navSub?.();
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

    const handleLogout = () => {
        if (isLoggingOut) return;
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

    const backTap = useTap({ onPress: router.back, disabled: isLoggingOut });
    const disableBackSwipe = useCallback(() => {
        navigation.setOptions({ gestureEnabled: false });
    }, [navigation]);
    const enableBackSwipe = useCallback(() => {
        navigation.setOptions({ gestureEnabled: true });
    }, [navigation]);
    const handleScrollEndDrag = useCallback(
        (event) => {
            const velocityY = event?.nativeEvent?.velocity?.y ?? 0;
            if (Math.abs(velocityY) < 0.1) {
                enableBackSwipe();
            } else {
                disableBackSwipe();
            }
        },
        [disableBackSwipe, enableBackSwipe]
    );

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
    const autoSendDescription = (
        <Text style={{ fontSize: 13, fontWeight: '500', lineHeight: 17, color: theme.muted }}>
            <Text style={{ color: theme.destructive }}>send immediately</Text> when the qr already includes an amount.
        </Text>
    );

    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <ScrollView
                contentContainerStyle={{
                    paddingTop: headerHeight,
                    paddingBottom: (footerHeight || insets.bottom + 40) + 8,
                }}
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                bounces
                alwaysBounceVertical
                directionalLockEnabled
                alwaysBounceHorizontal={false}
                onScrollBeginDrag={disableBackSwipe}
                onScrollEndDrag={handleScrollEndDrag}
                onMomentumScrollBegin={disableBackSwipe}
                onMomentumScrollEnd={enableBackSwipe}
            >
                <Row icon={CircleDollarSign} label="display currency" onPress={cycleMoneyFormat} right={<ValuePill label={MONEY_LABELS[moneyFormat]} />} disabled={isBusy} />
                <Row
                    icon={ScanQrCode}
                    label="auto send on scan"
                    description={autoSendDescription}
                    onPress={() => handleSendOnScan(!sendOnScan)}
                    right={<Switch value={sendOnScan} onValueChange={handleSendOnScan} {...autoSendSwitchProps} />}
                    disabled={isBusy}
                />

                <SectionDivider />

                <Row icon={Timer} label="lock timeout" onPress={cycleAutolockTimer} right={<ValuePill label={timerLabel(autolock.timer)} />} disabled={isBusy} />
                <Row
                    icon={Lock}
                    label="lock on app background"
                    onPress={() => handleLockOnBackground(!lockOnBackground)}
                    right={<Switch value={lockOnBackground} onValueChange={handleLockOnBackground} {...switchProps} />}
                    disabled={isBusy}
                />

                <SectionDivider />

                <Row
                    icon={FaceIdIcon}
                    label="use Face ID"
                    description="you may need to unlock with your password one more time before Face ID is ready on this device."
                    onPress={() => handleFaceIDToggle(!faceIDEnabled)}
                    right={<Switch value={faceIDEnabled} onValueChange={handleFaceIDToggle} {...switchProps} />}
                    disabled={isBusy}
                />

                <SectionDivider />

                <ClearCacheRow localCache={localCache} disabled={isBusy} />

                <SectionDivider />

                <Row icon={Settings} label="manage permissions" onPress={openPermissions} disabled={isBusy} />
                <Row icon={FileText} label="legal & support" onPress={openLegal} disabled={isBusy} />
                <Row icon={Shield} label="community rules" onPress={openCommunity} disabled={isBusy} />

                <SectionDivider />

                <Row icon={UserX} label="blocked users" onPress={openBlocked} disabled={isBusy} />
                <Row icon={KeyRound} label="export wallet" onPress={openExportWallet} disabled={isBusy || !encSeed} />
                <Row
                    left={isLoggingOut ? <ActivityIndicator color={theme.destructive} /> : <Icon icon={LogOut} size={26} color={theme.destructive} />}
                    label="logout"
                    onPress={handleLogout}
                    color={theme.destructive}
                    disabled={isBusy}
                />

                <SectionDivider />

                <Row
                    icon={Trash2}
                    label="delete account"
                    description="export or empty the wallet first. deleting can burn remaining bitcoin and chats forever."
                    onPress={handleDeleteAccount}
                    color={theme.destructive}
                    disabled={isBusy}
                />
            </ScrollView>

            <GlassHeader contentStyle={{ flexDirection: 'row', alignItems: 'center' }} onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
                <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                    <Pressable {...backTap.props} hitSlop={10} style={{ justifyContent: 'center' }} disabled={isBusy}>
                        <Animated.View style={{ transform: [{ scale: backTap.scale }] }}>
                            <Icon icon={ChevronLeft} color={theme.foreground} size={32} />
                        </Animated.View>
                    </Pressable>
                </View>
                <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text numberOfLines={1} style={{ fontSize: 20, fontWeight: '800', color: theme.foreground }}>settings</Text>
                </View>
                <View style={{ width: 56 }} />
            </GlassHeader>

            <GlassFooter onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)} contentStyle={{ alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '900', color: theme.foreground }}>v{appVersion}</Text>
            </GlassFooter>
        </View>
    );
}
