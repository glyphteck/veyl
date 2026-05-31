import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, ExternalLink, FileText, LifeBuoy, Mail, Shield } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GlassButton from '@/components/glass/glassbutton';
import GlassFooter from '@/components/glass/glassfooter';
import GlassHeader from '@/components/glass/glassheader';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
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
    const [footerHeight, setFooterHeight] = useState(0);
    const scrollRef = useRef(null);
    const backTap = useTap({ onPress: router.back });

    useEffect(() => {
        setSelectedKey(getLegalSection(textRouteParam(params?.section)).key);
    }, [params?.section]);

    useEffect(() => {
        scrollRef.current?.scrollTo?.({ y: 0, animated: false });
    }, [selectedKey]);

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
            <ScrollView
                ref={scrollRef}
                style={{ flex: 1 }}
                contentContainerStyle={{
                    paddingTop: insets.top + 56,
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

            <GlassHeader contentStyle={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                    <Pressable {...backTap.props} hitSlop={10} style={{ justifyContent: 'center' }}>
                        <Animated.View style={{ transform: [{ scale: backTap.scale }] }}>
                            <Icon icon={ChevronLeft} color={theme.foreground} size={32} />
                        </Animated.View>
                    </Pressable>
                </View>
                <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text numberOfLines={1} style={{ fontSize: 20, fontWeight: '800', color: theme.foreground }}>legal & support</Text>
                </View>
                <View style={{ width: 56 }} />
            </GlassHeader>
        </View>
    );
}
