import { createNavigatorFactory, TabRouter, useNavigationBuilder } from '@react-navigation/core';
import { withLayoutContext } from 'expo-router';
import PagerView from 'react-native-pager-view';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

function PagerNavigator({ initialRouteName, children, screenOptions, tabBar }) {
    const { state, navigation, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, {
        children,
        screenOptions,
        initialRouteName,
    });

    const pagerRef = useRef(null);
    const [blocking, setBlocking] = useState(false);

    const onPageScrollStateChanged = (e) => {
        const scrollState = e.nativeEvent.pageScrollState;
        if (scrollState === 'dragging') {
            setBlocking(true);
        } else if (scrollState === 'idle') {
            setBlocking(false);
        }
    };

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
