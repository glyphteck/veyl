import { createNavigatorFactory, TabRouter, useNavigationBuilder } from 'expo-router/react-navigation';
import { withLayoutContext } from 'expo-router';
import PagerView from 'react-native-pager-view';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

const WARM_OFFSET = 0.08;
const WARM_THROTTLE = 250;
const PagerRouteActiveContext = createContext(null);

export function usePagerRouteActive(fallback = false) {
    const active = useContext(PagerRouteActiveContext);
    return active == null ? fallback : active;
}

function PagerNavigator({ initialRouteName, children, screenOptions, tabBar, onRouteChange, onWarmRoute }) {
    const { state, navigation, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, {
        children,
        screenOptions,
        initialRouteName,
    });

    const pagerRef = useRef(null);
    const routesRef = useRef(state.routes);
    const stateIndexRef = useRef(state.index);
    const activeIndexRef = useRef(state.index);
    const ownedNavRef = useRef(new Set());
    const warmRef = useRef({ index: -1, time: 0 });
    const [blocking, setBlocking] = useState(false);
    const [pageIndex, setPageIndex] = useState(state.index);
    routesRef.current = state.routes;
    stateIndexRef.current = state.index;

    const setActiveIndex = useCallback((index) => {
        if (!Number.isInteger(index) || !routesRef.current[index]) return false;
        activeIndexRef.current = index;
        setPageIndex((current) => (current === index ? current : index));
        return true;
    }, []);

    const requestNav = useCallback(
        (index) => {
            const route = routesRef.current[index];
            if (!route || ownedNavRef.current.has(index)) return;
            if (index === stateIndexRef.current && ownedNavRef.current.size === 0) return;

            ownedNavRef.current.add(index);
            navigation.navigate(route.name);
        },
        [navigation]
    );

    const warmRoute = useCallback(
        (index) => {
            const route = routesRef.current[index];
            if (!route || !onWarmRoute) return;

            const now = Date.now();
            if (warmRef.current.index === index && now - warmRef.current.time < WARM_THROTTLE) return;
            warmRef.current = { index, time: now };
            onWarmRoute(route.name);
        },
        [onWarmRoute]
    );

    const onPageScrollStateChanged = (e) => {
        const scrollState = e.nativeEvent.pageScrollState;
        if (scrollState === 'dragging') {
            setBlocking(true);
        } else if (scrollState === 'idle') {
            setBlocking(false);
            warmRef.current = { index: -1, time: 0 };
        }
    };

    const onPageScroll = useCallback(
        (e) => {
            const { position, offset } = e.nativeEvent;
            if (!Number.isFinite(position) || !Number.isFinite(offset) || offset < WARM_OFFSET) return;

            const index = activeIndexRef.current;
            const targetIndex = position < index ? position : position === index ? position + 1 : -1;
            warmRoute(targetIndex);
        },
        [warmRoute]
    );

    const onPageSelected = useCallback(
        (e) => {
            const index = e.nativeEvent.position;
            if (!setActiveIndex(index)) return;
            requestNav(index);
        },
        [requestNav, setActiveIndex]
    );

    const navigateFromMenu = useCallback(
        (name) => {
            const index = routesRef.current.findIndex((route) => route.name === name);
            if (index === -1) {
                navigation.navigate(name);
                return;
            }

            if (!setActiveIndex(index)) return;
            pagerRef.current?.setPageWithoutAnimation(index);
            requestNav(index);
        },
        [navigation, requestNav, setActiveIndex]
    );

    useEffect(() => {
        const route = routesRef.current[pageIndex];
        if (route) onRouteChange?.(route.name);
    }, [onRouteChange, pageIndex]);

    useEffect(() => {
        const index = state.index;
        const owned = ownedNavRef.current;
        if (owned.delete(index)) {
            const activeIndex = activeIndexRef.current;
            if (activeIndex !== index && owned.has(activeIndex)) {
                navigation.navigate(routesRef.current[activeIndex].name);
            }
            return;
        }

        if (index !== activeIndexRef.current && setActiveIndex(index)) {
            pagerRef.current?.setPageWithoutAnimation(index);
        }
    }, [navigation, setActiveIndex, state.index]);

    const TabBar = tabBar;
    const tabState = pageIndex === state.index ? state : { ...state, index: pageIndex };
    const tabNavigation = { navigate: navigateFromMenu };

    return (
        <NavigationContent>
            <View style={{ flex: 1 }}>
                <PagerView
                    ref={pagerRef}
                    style={{ flex: 1 }}
                    initialPage={state.index}
                    offscreenPageLimit={state.routes.length}
                    onPageScroll={onPageScroll}
                    onPageScrollStateChanged={onPageScrollStateChanged}
                    onPageSelected={onPageSelected}
                >
                    {state.routes.map((route, index) => (
                        <View key={route.key} style={{ flex: 1 }} pointerEvents={blocking ? 'none' : 'auto'}>
                            <PagerRouteActiveContext.Provider value={pageIndex === index}>{descriptors[route.key].render()}</PagerRouteActiveContext.Provider>
                        </View>
                    ))}
                </PagerView>
                {TabBar && (
                    <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
                        <TabBar state={tabState} navigation={tabNavigation} />
                    </View>
                )}
            </View>
        </NavigationContent>
    );
}

export const Pager = withLayoutContext(createNavigatorFactory(PagerNavigator)().Navigator);
