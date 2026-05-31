import { Text, View } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StaticAvatar } from '@/components/avatar';
import GlassView from '@/components/glass/glassview';
import { bubbleTint } from '@/lib/chat/messages';
import { useTheme } from '@/providers/themeprovider';
import { DEFAULT_REACTION_EMOJI, MAX_REACTIONS, getMsgReactions } from '@veyl/shared/chat/messages';

export const REACTION_MARK_H = 24;
export const REACTION_MARK_INSET = 12;
export const REACTION_MARK_BOTTOM = -20;

const REACTION_BORDER = 3;
export const REACTION_SPACE = 20;
const REACTION_ANIMATION_MS = 160;
const REACTION_AVATAR = 16;
const REACTION_CONTENT_H = REACTION_AVATAR;
const REACTION_EMOJI_SIZE = 12;
const REACTION_EMOJI_W = 18;
const REACTION_PAD_X = 6;
const REACTION_INNER_GAP = 4;
const REACTION_GROUP_GAP = 2;
const REACTION_RADIUS = REACTION_MARK_H / 2;
const REACTION_OUTER_RADIUS = (REACTION_MARK_H + REACTION_BORDER * 2) / 2;
const TRAY_CLOSED_SCALE = 0.01;

function groupReactions(reactions) {
    const groups = [];
    const byEmoji = new Map();
    for (const reaction of getMsgReactions({ reactions })) {
        const emoji = reaction.emoji || DEFAULT_REACTION_EMOJI;
        let group = byEmoji.get(emoji);
        if (!group) {
            if (groups.length >= MAX_REACTIONS) continue;
            group = { emoji, users: [] };
            byEmoji.set(emoji, group);
            groups.push(group);
        }
        if (reaction.user && !group.users.includes(reaction.user)) {
            group.users.push(reaction.user);
        }
    }
    return groups;
}

function groupKey(group) {
    return group.emoji || DEFAULT_REACTION_EMOJI;
}

function groupStateKey(group) {
    return `${groupKey(group)}:${group.users.join(',')}`;
}

function makeItems(groups, entering = false) {
    return groups.map((group) => ({
        emoji: group.emoji,
        entering,
        exiting: false,
        users: group.users.map((user) => ({ user, entering, exiting: false })),
    }));
}

function reactionUsers(group, includeExiting = false) {
    return includeExiting ? group.users : group.users.filter((user) => !user.exiting);
}

function reactionItemWidth(group, { includeExiting = false } = {}) {
    const count = Math.max(1, reactionUsers(group, includeExiting).length);
    return REACTION_PAD_X * 2 + REACTION_EMOJI_W + REACTION_INNER_GAP * count + REACTION_AVATAR * count;
}

function userForReaction(users, reactionUser) {
    return users?.[reactionUser.user] ?? null;
}

function ReactionAvatar({ user, reactionUser }) {
    const width = useSharedValue(reactionUser.entering ? 0 : REACTION_AVATAR);
    const marginLeft = useSharedValue(reactionUser.entering ? 0 : REACTION_INNER_GAP);
    const scale = useSharedValue(reactionUser.entering ? 0.25 : 1);

    useEffect(() => {
        const timing = { duration: REACTION_ANIMATION_MS, easing: Easing.out(Easing.cubic) };
        width.value = withTiming(reactionUser.exiting ? 0 : REACTION_AVATAR, timing);
        marginLeft.value = withTiming(reactionUser.exiting ? 0 : REACTION_INNER_GAP, timing);
        scale.value = withTiming(reactionUser.exiting ? 0.25 : 1, timing);
    }, [marginLeft, reactionUser.exiting, scale, width]);

    const style = useAnimatedStyle(() => ({
        width: width.value,
        marginLeft: marginLeft.value,
        transform: [{ scale: scale.value }],
    }));

    if (!user) return null;

    return (
        <Animated.View
            style={[
                {
                    height: REACTION_AVATAR,
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                },
                style,
            ]}
        >
            <StaticAvatar bot={!!user.bot} source={user.source} size={REACTION_AVATAR} />
        </Animated.View>
    );
}

function Reaction({ reaction, users }) {
    const clips = reaction.entering || reaction.exiting;
    const targetWidth = reactionItemWidth(reaction, { includeExiting: true });
    const width = useSharedValue(reaction.entering ? 0 : targetWidth);

    useEffect(() => {
        if (!clips) {
            return;
        }
        const timing = { duration: REACTION_ANIMATION_MS, easing: Easing.out(Easing.cubic) };
        width.value = withTiming(reaction.exiting ? 0 : targetWidth, timing);
    }, [clips, reaction.exiting, targetWidth, width]);

    const style = useAnimatedStyle(() => (clips ? { width: width.value } : {}));

    return (
        <Animated.View
            style={[
                {
                    height: REACTION_CONTENT_H,
                    overflow: 'hidden',
                },
                style,
            ]}
        >
            <View
                style={{
                    height: REACTION_CONTENT_H,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    paddingHorizontal: REACTION_PAD_X,
                }}
            >
                <Text
                    style={{
                        width: REACTION_EMOJI_W,
                        height: REACTION_CONTENT_H,
                        fontSize: REACTION_EMOJI_SIZE,
                        lineHeight: REACTION_CONTENT_H,
                        includeFontPadding: false,
                        textAlign: 'center',
                    }}
                >
                    {reaction.emoji || DEFAULT_REACTION_EMOJI}
                </Text>
                {reaction.users.map((reactionUser) => (
                    <ReactionAvatar key={reactionUser.user} reactionUser={reactionUser} user={userForReaction(users, reactionUser)} />
                ))}
            </View>
        </Animated.View>
    );
}

export default function ReactionTray({ children, reactions, users, fromPeer = false, style }) {
    const { theme } = useTheme();
    const groups = useMemo(() => groupReactions(reactions), [reactions]);
    const groupsKey = groups.map(groupStateKey).join('|');
    const active = groups.length > 0;
    const [items, setItems] = useState(() => makeItems(groups));
    const [present, setPresent] = useState(active);
    const presentRef = useRef(active);
    const desiredActiveRef = useRef(active);
    const phaseRef = useRef(active ? 'open' : 'idle');
    const phaseTimerRef = useRef(null);
    const syncPhaseRef = useRef(null);
    const rowSpace = useSharedValue(active ? REACTION_SPACE : 0);
    const trayScale = useSharedValue(active ? 1 : TRAY_CLOSED_SCALE);

    const clearPhaseTimer = useCallback(() => {
        if (phaseTimerRef.current) {
            clearTimeout(phaseTimerRef.current);
            phaseTimerRef.current = null;
        }
    }, []);

    const setPresentState = useCallback((nextPresent) => {
        presentRef.current = nextPresent;
        setPresent(nextPresent);
    }, []);

    useEffect(() => {
        setItems((previous) => {
            if (!groups.length) {
                return previous.map((item) => ({
                    ...item,
                    entering: false,
                    exiting: false,
                    users: item.users.map((user) => ({ ...user, entering: false, exiting: false })),
                }));
            }

            if (!previous.length) {
                return makeItems(groups);
            }

            const previousByEmoji = new Map(previous.map((item) => [groupKey(item), item]));
            const nextKeys = new Set(groups.map(groupKey));
            const nextItems = groups.map((group) => {
                const previousItem = previousByEmoji.get(groupKey(group));
                const nextUsers = new Set(group.users);
                const usersForGroup = [];
                if (previousItem) {
                    for (const user of previousItem.users) {
                        if (nextUsers.has(user.user)) {
                            usersForGroup.push({ user: user.user, entering: false, exiting: false });
                        } else {
                            usersForGroup.push({ ...user, entering: false, exiting: true });
                        }
                    }
                }
                const previousUsers = new Set(usersForGroup.map((user) => user.user));
                for (const user of group.users) {
                    if (!previousUsers.has(user)) {
                        usersForGroup.push({ user, entering: true, exiting: false });
                    }
                }
                return {
                    emoji: group.emoji,
                    entering: !previousItem || previousItem.exiting,
                    exiting: false,
                    users: usersForGroup,
                };
            });

            for (const item of previous) {
                if (!nextKeys.has(groupKey(item))) {
                    nextItems.push({
                        ...item,
                        entering: false,
                        exiting: true,
                        users: item.users.map((user) => ({ ...user, entering: false, exiting: true })),
                    });
                }
            }

            return nextItems;
        });
    }, [groupsKey]);

    const startOpeningSpace = useCallback(() => {
        clearPhaseTimer();
        const timing = { duration: REACTION_ANIMATION_MS, easing: Easing.out(Easing.cubic) };
        phaseRef.current = 'opening-space';
        rowSpace.value = withTiming(REACTION_SPACE, timing);
        phaseTimerRef.current = setTimeout(() => {
            phaseTimerRef.current = null;
            if (phaseRef.current !== 'opening-space') {
                return;
            }
            phaseRef.current = 'space-open';
            syncPhaseRef.current?.();
        }, REACTION_ANIMATION_MS);
    }, [clearPhaseTimer, rowSpace]);

    const startOpeningTray = useCallback(() => {
        clearPhaseTimer();
        const timing = { duration: REACTION_ANIMATION_MS, easing: Easing.out(Easing.cubic) };
        phaseRef.current = 'opening-tray';
        if (!presentRef.current) {
            trayScale.value = TRAY_CLOSED_SCALE;
            setPresentState(true);
        }
        trayScale.value = withTiming(1, timing);
        phaseTimerRef.current = setTimeout(() => {
            phaseTimerRef.current = null;
            if (phaseRef.current !== 'opening-tray') {
                return;
            }
            phaseRef.current = 'open';
            syncPhaseRef.current?.();
        }, REACTION_ANIMATION_MS);
    }, [clearPhaseTimer, setPresentState, trayScale]);

    const startClosingTray = useCallback(() => {
        clearPhaseTimer();
        const timing = { duration: REACTION_ANIMATION_MS, easing: Easing.out(Easing.cubic) };
        phaseRef.current = 'closing-tray';
        trayScale.value = withTiming(TRAY_CLOSED_SCALE, timing);
        phaseTimerRef.current = setTimeout(() => {
            phaseTimerRef.current = null;
            if (phaseRef.current !== 'closing-tray') {
                return;
            }
            setPresentState(false);
            phaseRef.current = 'space-open';
            syncPhaseRef.current?.();
        }, REACTION_ANIMATION_MS);
    }, [clearPhaseTimer, setPresentState, trayScale]);

    const startClosingSpace = useCallback(() => {
        clearPhaseTimer();
        const timing = { duration: REACTION_ANIMATION_MS, easing: Easing.out(Easing.cubic) };
        phaseRef.current = 'closing-space';
        rowSpace.value = withTiming(0, timing);
        phaseTimerRef.current = setTimeout(() => {
            phaseTimerRef.current = null;
            if (phaseRef.current !== 'closing-space') {
                return;
            }
            phaseRef.current = 'idle';
            setItems([]);
        }, REACTION_ANIMATION_MS);
    }, [clearPhaseTimer, rowSpace]);

    const syncPhase = useCallback(() => {
        const desiredActive = desiredActiveRef.current;
        const phase = phaseRef.current;

        if (desiredActive) {
            if (phase === 'idle' || phase === 'closing-space') {
                startOpeningSpace();
                return;
            }
            if (phase === 'space-open' || phase === 'closing-tray') {
                startOpeningTray();
            }
            return;
        }

        if (phase === 'open' || phase === 'opening-tray') {
            startClosingTray();
            return;
        }
        if (phase === 'space-open' || phase === 'opening-space') {
            startClosingSpace();
        }
    }, [startClosingSpace, startClosingTray, startOpeningSpace, startOpeningTray]);

    useEffect(() => {
        syncPhaseRef.current = syncPhase;
    }, [syncPhase]);

    useEffect(() => {
        desiredActiveRef.current = active;
        syncPhase();
    }, [active, syncPhase]);

    useEffect(() => clearPhaseTimer, [clearPhaseTimer]);

    useEffect(() => {
        if (!items.some((item) => item.exiting || item.users.some((user) => user.exiting))) {
            return undefined;
        }
        const timeout = setTimeout(() => {
            setItems((previous) =>
                previous
                    .filter((item) => !item.exiting)
                    .map((item) => ({
                        ...item,
                        users: item.users.filter((user) => !user.exiting),
                    }))
                    .filter((item) => item.users.length > 0)
            );
        }, REACTION_ANIMATION_MS);
        return () => clearTimeout(timeout);
    }, [items]);

    const renderItems = useMemo(() => (items.length ? items : active ? makeItems(groups) : []), [active, groups, items]);
    const showTray = present && renderItems.length > 0;
    const spacerStyle = useAnimatedStyle(() => ({
        height: rowSpace.value,
    }));
    const trayStyle = useAnimatedStyle(() => ({
        bottom: REACTION_MARK_BOTTOM + REACTION_SPACE - REACTION_BORDER,
        transform: [{ scale: trayScale.value }],
    }));

    return (
        <Animated.View
            style={[
                {
                    position: 'relative',
                    maxWidth: '100%',
                },
                style,
            ]}
        >
            {children}
            <Animated.View pointerEvents="none" style={spacerStyle} />
            {showTray && (
                <Animated.View
                    pointerEvents="box-none"
                    style={[
                        {
                            position: 'absolute',
                            ...(fromPeer ? { left: REACTION_MARK_INSET } : { right: REACTION_MARK_INSET }),
                            borderRadius: REACTION_OUTER_RADIUS,
                            overflow: 'hidden',
                            backgroundColor: theme.background,
                            padding: REACTION_BORDER,
                            transformOrigin: fromPeer ? 'left center' : 'right center',
                        },
                        trayStyle,
                    ]}
                >
                    <GlassView
                        glassEffectStyle="clear"
                        tintColor={bubbleTint(theme, fromPeer)}
                        style={{
                            height: REACTION_MARK_H,
                            borderRadius: REACTION_RADIUS,
                            overflow: 'hidden',
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            gap: REACTION_GROUP_GAP,
                        }}
                    >
                        {renderItems.map((reaction) => (
                            <Reaction key={groupKey(reaction)} reaction={reaction} users={users} />
                        ))}
                    </GlassView>
                </Animated.View>
            )}
        </Animated.View>
    );
}
