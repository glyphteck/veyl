import { createNavigatorFactory, TabRouter, useNavigationBuilder } from '@react-navigation/core';
import { withLayoutContext } from 'expo-router';
import PagerView from 'react-native-pager-view';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

const WARM_OFFSET = 0.08;
const WARM_THROTTLE = 250;

function PagerNavigator({ initialRouteName, children, screenOptions, tabBar, onWarmRoute }) {
    const { state, navigation, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, {
        children,
        screenOptions,
        initialRouteName,
    });

    const pagerRef = useRef(null);
    const warmRef = useRef({ index: -1, time: 0 });
    const [blocking, setBlocking] = useState(false);

    const warmRoute = useCallback(
        (index) => {
            const route = state.routes[index];
            if (!route || !onWarmRoute) return;

            const now = Date.now();
            if (warmRef.current.index === index && now - warmRef.current.time < WARM_THROTTLE) return;
            warmRef.current = { index, time: now };
            onWarmRoute(route.name);
        },
        [onWarmRoute, state.routes]
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

            const targetIndex = position < state.index ? position : position === state.index ? position + 1 : -1;
            warmRoute(targetIndex);
        },
        [state.index, warmRoute]
    );

    // sync programmatic navigation (e.g. router.navigate) → PagerView position
    useEffect(() => {
        pagerRef.current?.setPageWithoutAnimation(state.index);
    }, [state.index]);

    const TabBar = tabBar;

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
                    onPageSelected={(e) => {
                        const route = state.routes[e.nativeEvent.position];
                        navigation.navigate(route.name);
                    }}
                >
                    {state.routes.map((route) => (
                        <View key={route.key} style={{ flex: 1 }} pointerEvents={blocking ? 'none' : 'auto'}>
                            {descriptors[route.key].render()}
                        </View>
                    ))}
                </PagerView>
                {TabBar && (
                    <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
                        <TabBar state={state} navigation={navigation} />
                    </View>
                )}
            </View>
        </NavigationContent>
    );
}

export const Pager = withLayoutContext(createNavigatorFactory(PagerNavigator)().Navigator);
