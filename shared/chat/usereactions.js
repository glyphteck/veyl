'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHAT_REACTION_WRITE_DELAY_MS } from '../config.js';
import { DEFAULT_REACTION_EMOJI, MAX_REACTIONS, getMsgReactions } from './messages.js';
import { indexMessagesByKey } from './messagekeys.js';
import { getMessageKey } from './state.js';

export const DEFAULT_REACTION_WRITE_DELAY_MS = CHAT_REACTION_WRITE_DELAY_MS;

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

function withActorReaction(message, actor, reaction, chatPK, peerChatPK) {
    const current = chatReactions(message, chatPK, peerChatPK).filter((item) => item.user !== actor);
    return orderReactions(reaction ? [...current, reaction] : current, chatPK, peerChatPK);
}

function latestMessageForKey(messageMap, id, fallback) {
    return (id && messageMap?.get?.(id)) || fallback;
}

function clearWriteTimer(entry) {
    if (entry?.timeoutId) {
        clearTimeout(entry.timeoutId);
        entry.timeoutId = null;
    }
}

function clearWriteTimers(writes) {
    for (const entry of writes?.values?.() || []) {
        clearWriteTimer(entry);
    }
}

function sentReactionCid(result) {
    return typeof result?.cid === 'string' && result.cid ? result.cid : '';
}

function writeSettled(entry, desiredKey, messageMap) {
    if (!entry) {
        return true;
    }
    if (entry.writing) {
        return false;
    }
    if (!entry.hasSent) {
        return true;
    }
    if (entry.sentKey !== desiredKey) {
        return false;
    }
    return !entry.sentCid || messageMap?.has?.(entry.sentCid);
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
    const flushWriteRef = useRef(null);
    const messageMap = useMemo(() => indexMessagesByKey(messages), [messages]);

    useEffect(() => {
        messagesByKeyRef.current = messageMap;
    }, [messageMap]);

    useEffect(() => {
        overridesRef.current = overrides;
    }, [overrides]);

    useEffect(() => {
        scopeRef.current = scopeKey;
        clearWriteTimers(writesRef.current);
        writesRef.current.clear();
        overridesRef.current = new Map();
        setOverrides(new Map());

        return () => clearWriteTimers(writesRef.current);
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

    const scheduleFlush = useCallback((id) => {
        const entry = writesRef.current.get(id);
        if (!entry) {
            return;
        }

        clearWriteTimer(entry);
        entry.timeoutId = setTimeout(() => {
            const current = writesRef.current.get(id);
            if (!current) {
                return;
            }
            current.timeoutId = null;
            flushWriteRef.current?.(id);
        }, DEFAULT_REACTION_WRITE_DELAY_MS);
    }, []);

    const deleteWrite = useCallback(
        (id) => {
            clearWriteTimer(writesRef.current.get(id));
            writesRef.current.delete(id);
            clearOverride(id);
        },
        [clearOverride]
    );

    const reactionsForMessage = useCallback(
        (message, overrideMap) => {
            const id = getMessageKey(message);
            const latest = latestMessageForKey(messagesByKeyRef.current, id, message);
            if (id && overrideMap?.has?.(id)) {
                return withActorReaction(latest, chatPK, overrideMap.get(id), chatPK, peerChatPK);
            }
            return chatReactions(latest, chatPK, peerChatPK);
        },
        [chatPK, peerChatPK]
    );

    const flushWrite = useCallback(
        (id) => {
            const entry = writesRef.current.get(id);
            if (!entry || entry.writing || !chatId || !peerChatPK || typeof sendReaction !== 'function') {
                return;
            }
            clearWriteTimer(entry);

            const desired = entry.desired;
            const sentKey = reactionStateKey(desired);
            const target = entry.target || id;
            if (!target) {
                deleteWrite(id);
                return;
            }

            entry.writing = true;
            entry.sentKey = sentKey;
            entry.scopeKey = scopeKey;

            sendReaction(peerChatPK, target, desired?.emoji ?? null)
                .then((result) => {
                    if (scopeRef.current !== entry.scopeKey) {
                        return;
                    }
                    const current = writesRef.current.get(id);
                    if (!current) {
                        return;
                    }
                    current.writing = false;
                    current.hasSent = true;
                    current.sentKey = sentKey;
                    current.sentCid = sentReactionCid(result);
                    if (reactionStateKey(current.desired) !== sentKey) {
                        scheduleFlush(id);
                        return;
                    }

                    const latest = messagesByKeyRef.current.get(id);
                    const latestReaction = latest ? actorReaction(chatReactions(latest, chatPK, peerChatPK), chatPK) : null;
                    if (latest && reactionStateKey(latestReaction) === sentKey && writeSettled(current, sentKey, messagesByKeyRef.current)) {
                        deleteWrite(id);
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
                        scheduleFlush(id);
                        return;
                    }

                    deleteWrite(id);
                    onError?.(error);
                });
        },
        [chatId, chatPK, deleteWrite, onError, peerChatPK, scheduleFlush, scopeKey, sendReaction]
    );

    useEffect(() => {
        flushWriteRef.current = flushWrite;
    }, [flushWrite]);

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
                clearWriteTimer(writesRef.current.get(id));
                writesRef.current.delete(id);
                changed = true;
                continue;
            }

            const latestReaction = actorReaction(chatReactions(message, chatPK, peerChatPK), chatPK);
            const desiredKey = reactionStateKey(desired);
            if (reactionStateKey(latestReaction) === desiredKey) {
                const entry = writesRef.current.get(id);
                if (!writeSettled(entry, desiredKey, messageMap)) {
                    continue;
                }
                nextOverrides.delete(id);
                clearWriteTimer(entry);
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
            return reactionsForMessage(message, overrides);
        },
        [overrides, reactionsForMessage]
    );

    const toggleReaction = useCallback(
        (message) => {
            const id = getMessageKey(message);
            if (!id || !chatPK) {
                return [];
            }

            const latest = latestMessageForKey(messagesByKeyRef.current, id, message);
            const current = reactionsForMessage(latest, overridesRef.current);
            const desired = actorReaction(current, chatPK) ? null : { emoji, user: chatPK };
            setOverride(id, desired);

            const currentWrite = writesRef.current.get(id);
            writesRef.current.set(id, {
                ...currentWrite,
                target: id,
                desired,
                writing: currentWrite?.writing === true,
            });
            scheduleFlush(id);
            return withActorReaction(latest, chatPK, desired, chatPK, peerChatPK);
        },
        [chatPK, emoji, peerChatPK, reactionsForMessage, scheduleFlush, setOverride]
    );

    return {
        getReactions,
        toggleReaction,
    };
}
