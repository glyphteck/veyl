import { Alert, Animated as RNAnimated, View, useWindowDimensions } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MenuPortal, getMenuPosition } from '@/components/menuportal';

const START_SCALE = 0.01;
const CLOSE_MS = 160;
const BACKDROP_MS = 160;
const SPRING = { useNativeDriver: true, speed: 30, bounciness: 10 };

const MenuContext = createContext(null);

export function MenuProvider({ children }) {
    const insets = useSafeAreaInsets();
    const { width: screenW, height: screenH } = useWindowDimensions();
    const [menu, setMenu] = useState(null);
    const menuScale = useRef(new RNAnimated.Value(START_SCALE)).current;
    const backdropOpacity = useRef(new RNAnimated.Value(0)).current;
    const frameRef = useRef(null);
    const menuRef = useRef(null);
    const closeTokenRef = useRef(0);

    menuRef.current = menu;

    const pos = useMemo(() => getMenuPosition(menu?.anchor, menu?.items?.length ?? 0, insets, screenW, screenH), [insets, menu?.anchor, menu?.items?.length, screenH, screenW]);

    useEffect(() => {
        if (!menu) return;

        menuScale.stopAnimation();
        backdropOpacity.stopAnimation();
        menuScale.setValue(START_SCALE);
        backdropOpacity.setValue(0);

        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            RNAnimated.parallel([
                RNAnimated.spring(menuScale, { ...SPRING, toValue: 1 }),
                RNAnimated.timing(backdropOpacity, { toValue: 1, duration: BACKDROP_MS, useNativeDriver: true }),
            ]).start();
        });

        return () => {
            if (frameRef.current) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };
    }, [backdropOpacity, menu?.id, menuScale]);

    useEffect(
        () => () => {
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
        },
        []
    );

    const close = useCallback(
        (idOrDone, done) => {
            const expectedId = typeof idOrDone === 'string' ? idOrDone : null;
            const cb = typeof idOrDone === 'function' ? idOrDone : typeof done === 'function' ? done : undefined;
            const current = menuRef.current;

            if (!current || (expectedId && current.id !== expectedId)) {
                cb?.();
                return;
            }

            const token = closeTokenRef.current + 1;
            closeTokenRef.current = token;

            if (frameRef.current) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }

            menuScale.stopAnimation();
            backdropOpacity.stopAnimation();

            RNAnimated.parallel([
                RNAnimated.timing(menuScale, { toValue: START_SCALE, duration: CLOSE_MS, useNativeDriver: true }),
                RNAnimated.timing(backdropOpacity, { toValue: 0, duration: CLOSE_MS, useNativeDriver: true }),
            ]).start(() => {
                if (closeTokenRef.current !== token) {
                    return;
                }
                current.release?.();
                menuRef.current = null;
                setMenu(null);
                cb?.();
            });
        },
        [backdropOpacity, menuScale]
    );

    const open = useCallback(
        ({ id, anchor, items, render, release, longScale = 0.96 }) => {
            if (!anchor || !Array.isArray(items) || !items.length || typeof render !== 'function') {
                release?.();
                return;
            }

            closeTokenRef.current += 1;
            menuRef.current?.release?.();
            menuScale.stopAnimation();
            backdropOpacity.stopAnimation();
            menuScale.setValue(START_SCALE);
            backdropOpacity.setValue(0);

            setMenu({
                id,
                anchor,
                items,
                render,
                release,
                longScale,
            });
        },
        [backdropOpacity, menuScale]
    );

    const update = useCallback((id, patch) => {
        if (!id || !patch) return;
        setMenu((current) => {
            if (!current || current.id !== id) {
                return current;
            }
            const next = { ...current, ...patch };
            menuRef.current = next;
            return next;
        });
    }, []);

    const runItem = useCallback(
        (item) => {
            close(() => {
                Promise.resolve(item?.run?.()).catch((error) => {
                    console.warn('menu action failed', error);
                    Alert.alert('Action failed', error?.message || 'Could not complete that action.');
                });
            });
        },
        [close]
    );

    const value = useMemo(
        () => ({
            active: !!menu,
            activeId: menu?.id ?? null,
            open,
            update,
            close,
        }),
        [close, menu?.id, open, update]
    );

    return (
        <MenuContext.Provider value={value}>
            <View style={{ flex: 1 }}>
                {children}
                <MenuPortal menu={menu} pos={pos} backdropOpacity={backdropOpacity} menuScale={menuScale} onClose={close} onRunItem={runItem} />
            </View>
        </MenuContext.Provider>
    );
}

export function useMenu() {
    const ctx = useContext(MenuContext);
    if (!ctx) throw new Error('useMenu must be used within a MenuProvider');
    return ctx;
}
