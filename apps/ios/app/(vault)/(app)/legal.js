import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ExternalLink, FileText, LifeBuoy, Mail, Shield } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import FloatingHeader, { FloatingHeaderBackIcon, FLOATING_HEADER_SCROLL_EDGE_PAD, getFloatingHeaderHeight } from '@/components/floatingheader';
import GlassButton from '@/components/glass/glassbutton';
import GlassFooter from '@/components/glass/glassfooter';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import { ScrollEdgeScreen } from '@/lib/navigation/scrolledge';
import { useTap } from '@/lib/tap';
import { LEGAL_EFFECTIVE_DATE, LEGAL_SECTION_ORDER, COMPANY_NAME, LEGAL_SECTIONS, getLegalSection } from '@veyl/shared/legal';
import { useTheme } from '@/providers/themeprovider';
import { textRouteParam } from '@veyl/shared/navigation/params';

const TAB_META = {
    privacy: { label: 'privacy', icon: Shield },
    terms: { label: 'terms', icon: FileText },
    support: { label: 'support', icon: LifeBuoy },
};
const TAB_STYLE = {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
};
const ACTIVE_SCALE = 1;
const INACTIVE_SCALE = 0.82;

const LINK_ICONS = {
    email: Mail,
    site: ExternalLink,
};

function LinkButton({ item, onPress }) {
    return (
        <GlassButton
            onPress={onPress}
            icon={LINK_ICONS[item.kind] || ExternalLink}
            label={item.label}
            glassEffectStyle="clear"
            pressableStyle={{ alignSelf: 'stretch' }}
            style={{ width: '100%' }}
        />
    );
}

function SectionTab({ tabKey, active, theme, onPress }) {
    const meta = TAB_META[tabKey];
    const activeScale = useRef(new Animated.Value(active ? ACTIVE_SCALE : INACTIVE_SCALE)).current;
    const tap = useTap({ onPress });

    useEffect(() => {
        Animated.spring(activeScale, {
            toValue: active ? ACTIVE_SCALE : INACTIVE_SCALE,
            useNativeDriver: true,
            speed: 24,
            bounciness: 12,
        }).start();
    }, [active, activeScale]);

    return (
        <Pressable {...tap.props} style={TAB_STYLE}>
            <Animated.View style={{ transform: [{ scale: Animated.multiply(activeScale, tap.scale) }] }}>
                <Icon icon={meta.icon} size={32} color={theme.foreground} />
            </Animated.View>
        </Pressable>
    );
}

export default function LegalRoute() {
    const { theme } = useTheme();
    const router = useRouter();
    const params = useLocalSearchParams();
    const insets = useSafeAreaInsets();
    const [selectedKey, setSelectedKey] = useState(getLegalSection(textRouteParam(params?.section)).key);
    const [headerHeight, setHeaderHeight] = useState(() => getFloatingHeaderHeight(insets.top));
    const [footerHeight, setFooterHeight] = useState(0);
    const headerInset = useMemo(() => ({ top: headerHeight }), [headerHeight]);
    const headerOffset = useMemo(() => ({ x: 0, y: -headerHeight }), [headerHeight]);
    const scrollRef = useRef(null);

    useEffect(() => {
        setSelectedKey(getLegalSection(textRouteParam(params?.section)).key);
    }, [params?.section]);

    useEffect(() => {
        scrollRef.current?.scrollTo?.({ y: -headerHeight, animated: false });
    }, [headerHeight, selectedKey]);

    const content = useMemo(() => LEGAL_SECTIONS[selectedKey] || LEGAL_SECTIONS.privacy, [selectedKey]);

    const openLink = useCallback(async (url) => {
        try {
            await Linking.openURL(url);
        } catch (error) {
            Alert.alert('Open failed', error?.message || 'Could not open that link.');
        }
    }, []);

    return (
        <View style={{ flex: 1 }}>
            <ScrollEdgeScreen>
                <ScrollView
                    ref={scrollRef}
                    style={{ flex: 1 }}
                    contentInset={headerInset}
                    contentOffset={headerOffset}
                    scrollIndicatorInsets={headerInset}
                    contentContainerStyle={{
                        paddingTop: FLOATING_HEADER_SCROLL_EDGE_PAD,
                        paddingBottom: (footerHeight || insets.bottom + 56) + 8,
                        paddingHorizontal: 16,
                        gap: 16,
                    }}
                    showsVerticalScrollIndicator={false}
                    bounces
                    alwaysBounceVertical
                >
                    <View style={{ gap: 16 }}>
                        <GlassView glassEffectStyle="clear" tintColor={theme.background} style={{ borderRadius: 28, paddingHorizontal: 18, paddingVertical: 18, gap: 12 }}>
                            <Text style={{ fontSize: 28, fontWeight: '900', color: theme.foreground }}>{content.title}</Text>
                            <Text style={{ fontSize: 13, fontWeight: '700', color: theme.muted }}>{`effective ${LEGAL_EFFECTIVE_DATE} - ${COMPANY_NAME}`}</Text>
                            <Text style={{ fontSize: 16, lineHeight: 24, color: theme.foreground }}>{content.intro}</Text>
                        </GlassView>

                        {content.sections.map((section) => (
                            <GlassView key={section.title} glassEffectStyle="clear" tintColor={theme.background} style={{ borderRadius: 24, paddingHorizontal: 18, paddingVertical: 18, gap: 10 }}>
                                <Text style={{ fontSize: 18, fontWeight: '900', color: theme.foreground }}>{section.title}</Text>
                                {section.body.map((line) => (
                                    <Text key={line} style={{ fontSize: 15, lineHeight: 23, color: theme.foreground }}>
                                        {line}
                                    </Text>
                                ))}
                            </GlassView>
                        ))}

                        <View style={{ gap: 10 }}>
                            {content.links.map((item) => (
                                <LinkButton key={item.label} item={item} onPress={() => openLink(item.url)} />
                            ))}
                        </View>
                    </View>
                </ScrollView>
            </ScrollEdgeScreen>

            <GlassFooter
                onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
                contentStyle={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                }}
            >
                {LEGAL_SECTION_ORDER.map((tabKey) => (
                    <SectionTab key={tabKey} tabKey={tabKey} active={selectedKey === tabKey} theme={theme} onPress={() => setSelectedKey(tabKey)} />
                ))}
            </GlassFooter>

            <FloatingHeader onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
                <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                    <FloatingHeaderBackIcon onPress={() => router.back()} />
                </View>
                <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text numberOfLines={1} style={{ fontSize: 20, fontWeight: '800', color: theme.foreground }}>legal & support</Text>
                </View>
                <View style={{ width: 56 }} />
            </FloatingHeader>
        </View>
    );
}
