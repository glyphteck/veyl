import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Text, View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COMMUNITY_RULES_EFFECTIVE, COMMUNITY_RULES_VERSION, COMMUNITY_SECTIONS, hasCurrentCommunityRules } from '@veyl/shared/community';

import FloatingHeader, { FloatingHeaderBackIcon, FLOATING_HEADER_SCROLL_EDGE_PAD, getFloatingHeaderHeight } from '@/components/floatingheader';
import GlassButton from '@/components/glass/glassbutton';
import GlassView from '@/components/glass/glassview';
import { ScrollEdgeScreen } from '@/lib/navigation/scrolledge';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';

export default function Community({ ackMode = false }) {
    const { theme } = useTheme();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { communityRulesVersion, communityRulesAcceptedAt, communityRulesPending, acceptCommunityRules } = useUser();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [canContinue, setCanContinue] = useState(false);
    const [headerHeight, setHeaderHeight] = useState(() => getFloatingHeaderHeight(insets.top));
    const headerInset = useMemo(() => ({ top: headerHeight }), [headerHeight]);
    const headerOffset = useMemo(() => ({ x: 0, y: -headerHeight }), [headerHeight]);

    const acceptedCurrentVersion = hasCurrentCommunityRules({ communityRulesVersion, communityRulesAcceptedAt, communityRulesPending });

    useEffect(() => {
        setCanContinue(!ackMode || acceptedCurrentVersion);
    }, [acceptedCurrentVersion, ackMode]);

    const handleScroll = useCallback(
        (event) => {
            if (!ackMode || canContinue) return;
            const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
            if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 32) {
                setCanContinue(true);
            }
        },
        [ackMode, canContinue]
    );

    const handleContinue = useCallback(async () => {
        if (!ackMode || !canContinue) return;
        if (acceptedCurrentVersion) return;

        setIsSubmitting(true);
        try {
            await acceptCommunityRules(COMMUNITY_RULES_VERSION);
        } catch (error) {
            console.warn('community rules acknowledgement failed', error);
            Alert.alert('Not saved', error?.message || 'Could not save your acknowledgement.');
            setIsSubmitting(false);
        }
    }, [acceptCommunityRules, acceptedCurrentVersion, ackMode, canContinue]);

    return (
        <View style={{ flex: 1 }}>
            <ScrollEdgeScreen>
                <ScrollView
                    style={{ flex: 1 }}
                    onScroll={handleScroll}
                    scrollEventThrottle={16}
                    contentInset={headerInset}
                    contentOffset={headerOffset}
                    scrollIndicatorInsets={headerInset}
                    contentContainerStyle={{
                        paddingTop: FLOATING_HEADER_SCROLL_EDGE_PAD,
                        paddingBottom: insets.bottom + (ackMode ? 88 : 0),
                        paddingHorizontal: 16,
                        gap: 16,
                    }}
                    showsVerticalScrollIndicator={false}
                    bounces
                    alwaysBounceVertical
                >
                    <View style={{ gap: 16 }}>
                        {COMMUNITY_SECTIONS.map((section) => (
                            <GlassView key={section.title} glassEffectStyle="clear" tintColor={theme.background} style={{ borderRadius: 24, paddingHorizontal: 18, paddingVertical: 18, gap: 10 }}>
                                <Text style={{ fontSize: 18, fontWeight: '900', color: theme.foreground }}>{section.title}</Text>
                                {section.body.map((line) => (
                                    <Text key={line} style={{ fontSize: 15, lineHeight: 23, color: theme.foreground }}>
                                        {line}
                                    </Text>
                                ))}
                            </GlassView>
                        ))}
                    </View>
                </ScrollView>
            </ScrollEdgeScreen>

            {ackMode ? (
                <GlassButton
                    style={{ position: 'absolute', bottom: insets.bottom + 16, left: 16, right: 16 }}
                    onPress={handleContinue}
                    label={isSubmitting ? 'saving…' : 'agree & continue'}
                    accent
                    disabled={isSubmitting || acceptedCurrentVersion || !canContinue}
                />
            ) : null}

            <FloatingHeader onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
                <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                    {!ackMode ? <FloatingHeaderBackIcon onPress={() => router.back()} /> : null}
                </View>

                <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 24, fontWeight: '800', color: theme.foreground }}>community rules</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: theme.muted }}>
                        issued {COMMUNITY_RULES_EFFECTIVE}
                    </Text>
                </View>
                <View style={{ width: 56 }} />
            </FloatingHeader>
        </View>
    );
}
