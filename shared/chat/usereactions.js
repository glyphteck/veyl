'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_REACTION_EMOJI, MAX_REACTIONS, getMsgReactions } from './messages.js';

function msgKey(message) {
    return message?.cid || message?.id || null;
}

function reactionStateKey(reaction) {
    return reaction ? `${reaction.user}:${reaction.emoji}` : '';
}

function actorReaction(reactions, actor) {
    return getMsgReactions({ reactions }).find((reaction) => reaction.user === actor) ?? null;
}

function orderReactions(reactions, chatPK, peerChatPK) {
    const byUser = new Map();
    for (const reaction of getMsgReactions({ reactions })) {
        byUser.set(reaction.user, reaction);
    }
    return [chatPK, peerChatPK].map((user) => byUser.get(user)).filter(Boolean).slice(0, MAX_REACTIONS);
}

export function chatReactions(msg, chatPK, peerChatPK) {
    const users = new Set([chatPK, peerChatPK].filter(Boolean));
    return orderReactions(
        getMsgReactions(msg).filter((reaction) => users.has(reaction.user)),
        chatPK,
        peerChatPK
    );
}

function messagesByKey(messages) {
    const map = new Map();
    for (const message of messages || []) {
        if (message?.id) {
            map.set(message.id, message);
        }
        if (message?.cid) {
            map.set(message.cid, message);
        }
    }
    return map;
}

function withActorReaction(message, actor, reaction, chatPK, peerChatPK) {
    const current = chatReactions(message, chatPK, peerChatPK).filter((item) => item.user !== actor);
    return orderReactions(reaction ? [...current, reaction] : current, chatPK, peerChatPK);
}

export function useOptimisticMessageReactions({
    chatId,
    chatPK,
    peerChatPK,
    messages,
    sendReaction,
    emoji = DEFAULT_REACTION_EMOJI,
    onError,
}) {
    const scopeKey = `${chatId || ''}:${chatPK || ''}:${peerChatPK || ''}`;
    const [overrides, setOverrides] = useState(() => new Map());
    const overridesRef = useRef(overrides);
    const writesRef = useRef(new Map());
    const scopeRef = useRef(scopeKey);
    const messagesByKeyRef = useRef(new Map());
    const messageMap = useMemo(() => messagesByKey(messages), [messages]);

    useEffect(() => {
        messagesByKeyRef.current = messageMap;
    }, [messageMap]);

    useEffect(() => {
        overridesRef.current = overrides;
    }, [overrides]);

    useEffect(() => {
        scopeRef.current = scopeKey;
        writesRef.current.clear();
        overridesRef.current = new Map();
        setOverrides(new Map());
    }, [scopeKey]);

    const setOverride = useCallback((id, reaction) => {
        setOverrides((current) => {
            const next = new Map(current);
            next.set(id, reaction);
            overridesRef.current = next;
            return next;
        });
    }, []);

    const clearOverride = useCallback((id) => {
        setOverrides((current) => {
            if (!current.has(id)) {
                return current;
            }
            const next = new Map(current);
            next.delete(id);
            overridesRef.current = next;
            return next;
        });
    }, []);

    const flushWrite = useCallback(
        (id) => {
            const entry = writesRef.current.get(id);
            if (!entry || entry.writing || !chatId || !peerChatPK || typeof sendReaction !== 'function') {
                return;
            }

            const desired = entry.desired;
            const sentKey = reactionStateKey(desired);
            const target = entry.target || id;
            if (!target) {
                writesRef.current.delete(id);
                clearOverride(id);
                return;
            }

            entry.writing = true;
            entry.sentKey = sentKey;
            entry.scopeKey = scopeKey;

            sendReaction(peerChatPK, target, desired?.emoji ?? null)
                .then(() => {
                    if (scopeRef.current !== entry.scopeKey) {
                        return;
                    }
                    const current = writesRef.current.get(id);
                    if (!current) {
                        return;
                    }
                    current.writing = false;
                    if (reactionStateKey(current.desired) !== sentKey) {
                        flushWrite(id);
                        return;
                    }

                    const latest = messagesByKeyRef.current.get(id);
                    const latestReaction = latest ? actorReaction(chatReactions(latest, chatPK, peerChatPK), chatPK) : null;
                    if (latest && reactionStateKey(latestReaction) === sentKey) {
                        writesRef.current.delete(id);
                        clearOverride(id);
                    }
                })
                .catch((error) => {
                    if (scopeRef.current !== entry.scopeKey) {
                        return;
                    }
                    const current = writesRef.current.get(id);
                    if (!current) {
                        return;
                    }
                    current.writing = false;
                    if (reactionStateKey(current.desired) !== sentKey) {
                        flushWrite(id);
                        return;
                    }

                    writesRef.current.delete(id);
                    clearOverride(id);
                    onError?.(error);
                });
        },
        [chatId, chatPK, clearOverride, onError, peerChatPK, scopeKey, sendReaction]
    );

    useEffect(() => {
        if (!overrides.size) {
            return;
        }

        let changed = false;
        const nextOverrides = new Map(overrides);
        for (const [id, desired] of overrides) {
            const message = messageMap.get(id);
            if (!message) {
                nextOverrides.delete(id);
                writesRef.current.delete(id);
                changed = true;
                continue;
            }

            const latestReaction = actorReaction(chatReactions(message, chatPK, peerChatPK), chatPK);
            if (reactionStateKey(latestReaction) === reactionStateKey(desired)) {
                const entry = writesRef.current.get(id);
                if (entry?.writing) {
                    continue;
                }
                nextOverrides.delete(id);
                writesRef.current.delete(id);
                changed = true;
            }
        }

        if (changed) {
            overridesRef.current = nextOverrides;
            setOverrides(nextOverrides);
        }
    }, [chatPK, messageMap, overrides, peerChatPK]);

    const getReactions = useCallback(
        (message) => {
            const id = msgKey(message);
            if (id && overrides.has(id)) {
                return withActorReaction(message, chatPK, overrides.get(id), chatPK, peerChatPK);
            }
            return chatReactions(message, chatPK, peerChatPK);
        },
        [chatPK, overrides, peerChatPK]
    );

    const toggleReaction = useCallback(
        (message) => {
            const id = msgKey(message);
            if (!id || !chatPK) {
                return [];
            }

            const current = getReactions(message);
            const desired = actorReaction(current, chatPK) ? null : { emoji, user: chatPK };
            setOverride(id, desired);

            const currentWrite = writesRef.current.get(id);
            writesRef.current.set(id, {
                ...currentWrite,
                target: id,
                desired,
                writing: currentWrite?.writing === true,
            });
            flushWrite(id);
            return withActorReaction(message, chatPK, desired, chatPK, peerChatPK);
        },
        [chatPK, emoji, flushWrite, getReactions, peerChatPK, setOverride]
    );

    return {
        getReactions,
        toggleReaction,
    };
}
