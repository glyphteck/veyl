import { TabRouter, useNavigationBuilder } from 'expo-router/react-navigation';
import { withLayoutContext } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, View } from 'react-native';
import PagerView from 'react-native-pager-view';

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);
const SELECTION_POSITION_TOLERANCE = 0.75;
const WARM_OFFSET = 0.08;

function routeAt(routes, index) {
    return Number.isInteger(index) ? routes[index] : null;
}

function HomePagerNavigator({ initialRouteName, children, screenOptions, tabBar, onRouteChange, onWarmRoute, swipeEnabled = true }) {
    const { state, navigation, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, {
        children,
        screenOptions,
        initialRouteName,
        backBehavior: 'none',
    });

    const pagerRef = useRef(null);
    const routesRef = useRef(state.routes);
    const currentPageRef = useRef(state.index);
    const busyRef = useRef(false);
    const swipeEnabledRef = useRef(swipeEnabled);
    const livePageRef = useRef(state.index);
    const expectedPageRef = useRef(state.index);
    const warmRouteRef = useRef(null);
    const pagePosition = useRef(new Animated.Value(state.index)).current;
    const pageOffset = useRef(new Animated.Value(0)).current;
    const livePosition = useMemo(() => Animated.add(pagePosition, pageOffset), [pageOffset, pagePosition]);
    routesRef.current = state.routes;

    const markBusy = useCallback((busy) => {
        busyRef.current = busy;
    }, []);

    useEffect(() => {
        const enabled = !!swipeEnabled;
        swipeEnabledRef.current = enabled;
        pagerRef.current?.setScrollEnabled?.(enabled);
        if (enabled) return;

        markBusy(false);
        pageOffset.setValue(0);
        pagePosition.setValue(currentPageRef.current);
        livePageRef.current = currentPageRef.current;
        expectedPageRef.current = currentPageRef.current;
    }, [markBusy, pageOffset, pagePosition, swipeEnabled]);

    const warmRoute = useCallback(
        (index) => {
            const route = routeAt(routesRef.current, index);
            if (!route || warmRouteRef.current === route.name) return;
            warmRouteRef.current = route.name;
            onWarmRoute?.(route.name);
        },
        [onWarmRoute]
    );

    const moveToIndex = useCallback(
        (index, source) => {
            const route = routeAt(routesRef.current, index);
            if (!route) return;

            currentPageRef.current = index;
            livePageRef.current = index;
            expectedPageRef.current = index;
            pagePosition.setValue(index);
            pageOffset.setValue(0);
            warmRoute(index);
            if (source !== 'pager') {
                pagerRef.current?.setPageWithoutAnimation(index);
            }
            navigation.navigate(route.name, route.params);
        },
        [navigation, pageOffset, pagePosition, warmRoute]
    );

    useEffect(() => {
        const index = state.index;
        if (currentPageRef.current === index) return;

        currentPageRef.current = index;
        livePageRef.current = index;
        expectedPageRef.current = index;
        pagePosition.setValue(index);
        pageOffset.setValue(0);
        pagerRef.current?.setPageWithoutAnimation(index);
    }, [pageOffset, pagePosition, state.index]);

    useEffect(() => {
        const route = routeAt(state.routes, state.index);
        if (!route) return;
        onRouteChange?.(route.name);
        warmRoute(state.index);
    }, [onRouteChange, state.index, state.routes, warmRoute]);

    const onPageScroll = useMemo(
        () =>
            Animated.event(
                [
                    {
                        nativeEvent: {
                            position: pagePosition,
                            offset: pageOffset,
                        },
                    },
                ],
                {
                    useNativeDriver: true,
                    listener: (event) => {
                        const { position, offset } = event.nativeEvent;
                        if (!Number.isFinite(position) || !Number.isFinite(offset)) return;

                        const livePage = position + offset;
                        livePageRef.current = livePage;
                        expectedPageRef.current = Math.min(Math.max(0, Math.round(livePage)), routesRef.current.length - 1);
                        if (offset < WARM_OFFSET) return;
                        const current = currentPageRef.current;
                        const targetIndex = position < current ? position : position === current ? position + 1 : position;
                        warmRoute(targetIndex);
                    },
                }
            ),
        [pageOffset, pagePosition, warmRoute]
    );

    const onPageScrollStateChanged = useCallback(
        (event) => {
            const scrollState = event.nativeEvent.pageScrollState;
            if (scrollState === 'dragging' || scrollState === 'settling') {
                markBusy(true);
            } else if (scrollState === 'idle') {
                markBusy(false);
                pageOffset.setValue(0);
                pagePosition.setValue(currentPageRef.current);
                livePageRef.current = currentPageRef.current;
                expectedPageRef.current = currentPageRef.current;
            }
        },
        [markBusy, pageOffset, pagePosition]
    );

    const onPageSelected = useCallback(
        (event) => {
            const index = event.nativeEvent.position;
            if (!swipeEnabledRef.current) return;
            if (!busyRef.current) return;
            if (index === currentPageRef.current) return;
            if (index !== expectedPageRef.current && Math.abs(index - livePageRef.current) > SELECTION_POSITION_TOLERANCE) return;
            moveToIndex(index, 'pager');
        },
        [moveToIndex]
    );

    const navigateFromMenu = useCallback(
        (name, params) => {
            const route = routesRef.current.find((item) => item.name === name);
            if (!route) {
                navigation.navigate(name, params);
                return;
            }

            const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
            });
            if (event.defaultPrevented) return;

            const index = routesRef.current.findIndex((item) => item.key === route.key);
            if (index === currentPageRef.current) return;
            moveToIndex(index, 'menu');
        },
        [moveToIndex, navigation]
    );

    const TabBar = tabBar;
    const tabNavigation = useMemo(() => ({ ...navigation, navigate: navigateFromMenu }), [navigateFromMenu, navigation]);

    return (
        <NavigationContent>
            <View style={{ flex: 1 }}>
                <AnimatedPagerView
                    ref={pagerRef}
                    style={{ flex: 1 }}
                    initialPage={state.index}
                    offscreenPageLimit={state.routes.length}
                    scrollEnabled={swipeEnabled}
                    onPageScroll={onPageScroll}
                    onPageScrollStateChanged={onPageScrollStateChanged}
                    onPageSelected={onPageSelected}
                >
                    {state.routes.map((route) => (
                        <View key={route.key} style={[{ flex: 1 }, descriptors[route.key].options?.sceneStyle]}>
                            {descriptors[route.key].render()}
                        </View>
                    ))}
                </AnimatedPagerView>
                {TabBar ? <TabBar state={state} navigation={tabNavigation} position={livePosition} onWarmRoute={onWarmRoute} /> : null}
            </View>
        </NavigationContent>
    );
}

export const HomePager = withLayoutContext(HomePagerNavigator);
