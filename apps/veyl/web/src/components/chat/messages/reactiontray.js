'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { StaticAvatar } from '@/components/avatar';
import { bubbleBg } from '@/lib/messages';
import { DEFAULT_REACTION_EMOJI, MAX_REACTIONS, getMsgReactions } from '@glyphteck/shared/chat/messages';

const REACTION_MARK_H = 24;
const REACTION_MARK_INSET = 12;
const REACTION_MARK_BOTTOM = -19;
const REACTION_BORDER = 3;
const REACTION_SPACE = 21;
const REACTION_ANIMATION_MS = 160;
const REACTION_AVATAR = 16;
const REACTION_EMOJI_SIZE = 12;
const REACTION_EMOJI_W = 14;
const REACTION_PAD_X = 6;
const REACTION_INNER_GAP = 4;
const REACTION_GROUP_GAP = 2;
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

function ReactionAvatar({ reactionUser, user }) {
    const [shown, setShown] = useState(!reactionUser.entering && !reactionUser.exiting);

    useEffect(() => {
        if (reactionUser.exiting) {
            setShown(false);
            return undefined;
        }

        const frame = requestAnimationFrame(() => setShown(true));
        return () => cancelAnimationFrame(frame);
    }, [reactionUser.exiting, reactionUser.user]);

    if (!user) return null;
    const avatar = typeof user.avatar === 'string' && user.avatar ? user.avatar : '';

    return (
        <span
            className="inline-flex h-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-background bg-cover bg-center transition-[width,margin,transform] ease-out"
            style={{
                width: shown ? REACTION_AVATAR : 0,
                marginLeft: shown ? REACTION_INNER_GAP : 0,
                transform: `scale(${shown ? 1 : 0.25})`,
                transitionDuration: `${REACTION_ANIMATION_MS}ms`,
            }}
            aria-hidden="true"
        >
            <StaticAvatar bot={!!user.bot} src={avatar} aria-hidden="true" />
        </span>
    );
}

function Reaction({ reaction, users }) {
    const [shown, setShown] = useState(!reaction.entering && !reaction.exiting);
    const clips = reaction.entering || reaction.exiting;
    const width = reactionItemWidth(reaction, { includeExiting: true });

    useEffect(() => {
        if (reaction.exiting) {
            setShown(false);
            return undefined;
        }

        const frame = requestAnimationFrame(() => setShown(true));
        return () => cancelAnimationFrame(frame);
    }, [reaction.entering, reaction.exiting, reaction.emoji]);

    return (
        <span
            className="inline-flex h-[25px] shrink-0 items-center justify-start overflow-hidden transition-[width] ease-out"
            style={{
                width: clips ? (shown ? width : 0) : undefined,
                transitionDuration: `${REACTION_ANIMATION_MS}ms`,
            }}
        >
            <span className="inline-flex h-[25px] items-center justify-start" style={{ paddingInline: REACTION_PAD_X }}>
                <span className="inline-flex items-center justify-center leading-none" style={{ width: REACTION_EMOJI_W, fontSize: REACTION_EMOJI_SIZE }}>
                    {reaction.emoji || DEFAULT_REACTION_EMOJI}
                </span>
                {reaction.users.map((reactionUser) => (
                    <ReactionAvatar key={reactionUser.user} reactionUser={reactionUser} user={userForReaction(users, reactionUser)} />
                ))}
            </span>
        </span>
    );
}

export default function ReactionTray({ children, reactions, users, fromPeer = false, actionSlot }) {
    const groups = useMemo(() => groupReactions(reactions), [reactions]);
    const groupsKey = groups.map(groupStateKey).join('|');
    const active = groups.length > 0;
    const [items, setItems] = useState(() => makeItems(groups));
    const [spaceReserved, setSpaceReserved] = useState(active);
    const [trayShown, setTrayShown] = useState(active);
    const previousActive = useRef(active);

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

    useEffect(() => {
        if (active) {
            setSpaceReserved(true);
            if (!previousActive.current) {
                previousActive.current = true;
                setTrayShown(false);
                const frame = requestAnimationFrame(() => setTrayShown(true));
                return () => cancelAnimationFrame(frame);
            }
            previousActive.current = true;
            setTrayShown(true);
            return undefined;
        }
        if (!previousActive.current) return undefined;
        previousActive.current = false;
        setTrayShown(false);
        const timeout = setTimeout(() => {
            setSpaceReserved(false);
            setItems([]);
        }, REACTION_ANIMATION_MS);
        return () => clearTimeout(timeout);
    }, [active]);

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
    const present = renderItems.length > 0;
    const rowSpace = spaceReserved ? REACTION_SPACE : 0;
    const trayScale = trayShown ? 1 : TRAY_CLOSED_SCALE;

    return (
        <div
            className="relative inline-block max-w-full"
            style={{
                paddingBottom: rowSpace,
                transition: `padding-bottom ${REACTION_ANIMATION_MS}ms ease-out`,
            }}
        >
            <div className="relative inline-block max-w-full align-top">
                {children}
                {actionSlot}
            </div>
            {present && (
                <span
                    className="absolute z-10 inline-flex overflow-hidden rounded-full bg-background"
                    style={{
                        bottom: REACTION_MARK_BOTTOM + rowSpace - REACTION_BORDER,
                        ...(fromPeer ? { left: REACTION_MARK_INSET, transformOrigin: 'left center' } : { right: REACTION_MARK_INSET, transformOrigin: 'right center' }),
                        padding: REACTION_BORDER,
                        transform: `scale(${trayScale})`,
                        transition: `transform ${REACTION_ANIMATION_MS}ms ease-out`,
                    }}
                >
                    <span
                        className={`inline-flex items-center justify-start overflow-hidden rounded-full shadow-sm backdrop-blur-sm ${bubbleBg(fromPeer)}`}
                        style={{
                            height: REACTION_MARK_H,
                            gap: REACTION_GROUP_GAP,
                        }}
                    >
                        {renderItems.map((reaction) => (
                            <Reaction key={groupKey(reaction)} reaction={reaction} users={users} />
                        ))}
                    </span>
                </span>
            )}
        </div>
    );
}
