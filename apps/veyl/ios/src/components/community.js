import { useCallback, useEffect, useState } from 'react';
import { Alert, Animated, Pressable, Text, View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GlassButton from '@/components/glass/glassbutton';
import GlassFooter from '@/components/glass/glassfooter';
import GlassHeader from '@/components/glass/glassheader';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import { useTap } from '@/lib/tap';
import { COMMUNITY_RULES_EFFECTIVE, COMMUNITY_RULES_VERSION, COMMUNITY_SECTIONS, hasCurrentCommunityRules } from '@/lib/community';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';

export default function Community({ ackMode = false }) {
    const { theme } = useTheme();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { communityRulesVersion, communityRulesAcceptedAt, communityRulesPending, acceptCommunityRules } = useUser();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [canContinue, setCanContinue] = useState(false);
    const backTap = useTap({ onPress: router.back });

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
            <ScrollView
                style={{ flex: 1 }}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                contentContainerStyle={{
                    paddingTop: insets.top + 60,
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

            {ackMode ? (
                <GlassButton
                    style={{ position: 'absolute', bottom: insets.bottom + 16, left: 16, right: 16 }}
                    onPress={handleContinue}
                    label={isSubmitting ? 'saving…' : 'agree & continue'}
                    accent
                    disabled={isSubmitting || acceptedCurrentVersion || !canContinue}
                />
            ) : null}

            <GlassHeader contentStyle={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                    {!ackMode ? (
                        <Pressable {...backTap.props} hitSlop={10} style={{ justifyContent: 'center' }}>
                            <Animated.View style={{ transform: [{ scale: backTap.scale }] }}>
                                <Icon icon={ChevronLeft} size={32} color={theme.foreground} />
                            </Animated.View>
                        </Pressable>
                    ) : null}
                </View>

                <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 24, fontWeight: '800', color: theme.foreground }}>community rules</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: theme.muted }}>
                        {COMMUNITY_RULES_VERSION} - {COMMUNITY_RULES_EFFECTIVE}
                    </Text>
                </View>
                <View style={{ width: 56 }} />
            </GlassHeader>
        </View>
    );
}
