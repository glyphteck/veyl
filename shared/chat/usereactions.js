'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    DEFAULT_REACTION_EMOJI,
    getMsgReactions,
    setMsgReactions,
    toggleReaction as toggleMsgReaction,
} from './messages.js';

function msgId(message) {
    return message?.id || null;
}

function reactionKey(reactions) {
    return getMsgReactions({ reactions })
        .map((reaction) => `${reaction.user}:${reaction.emoji}`)
        .sort()
        .join('|');
}

export function chatReactions(msg, chatPK, peerChatPK) {
    const users = new Set([chatPK, peerChatPK].filter(Boolean));
    return getMsgReactions(msg).filter((reaction) => users.has(reaction.user));
}

function messagesById(messages) {
    const map = new Map();
    for (const message of messages || []) {
        const id = msgId(message);
        if (id) {
            map.set(id, message);
        }
    }
    return map;
}

export function useOptimisticMessageReactions({
    chatId,
    chatPK,
    peerChatPK,
    messages,
    updateMessage,
    emoji = DEFAULT_REACTION_EMOJI,
    onError,
}) {
    const scopeKey = `${chatId || ''}:${chatPK || ''}:${peerChatPK || ''}`;
    const [overrides, setOverrides] = useState(() => new Map());
    const overridesRef = useRef(overrides);
    const writesRef = useRef(new Map());
    const scopeRef = useRef(scopeKey);
    const messagesByIdRef = useRef(new Map());
    const messageMap = useMemo(() => messagesById(messages), [messages]);

    useEffect(() => {
        messagesByIdRef.current = messageMap;
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

    const setOverride = useCallback((id, reactions) => {
        const clean = getMsgReactions({ reactions });
        setOverrides((current) => {
            const next = new Map(current);
            next.set(id, clean);
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
            if (!entry || entry.writing || !chatId || !peerChatPK || typeof updateMessage !== 'function') {
                return;
            }

            const desired = getMsgReactions({ reactions: entry.desired });
            const sentKey = reactionKey(desired);
            const base = messagesByIdRef.current.get(id) || entry.baseMessage;
            if (!base) {
                writesRef.current.delete(id);
                clearOverride(id);
                return;
            }

            entry.writing = true;
            entry.sentKey = sentKey;
            entry.scopeKey = scopeKey;

            updateMessage(chatId, id, setMsgReactions(base, desired), peerChatPK, { updateLastMsg: false })
                .then(() => {
                    if (scopeRef.current !== entry.scopeKey) {
                        return;
                    }
                    const current = writesRef.current.get(id);
                    if (!current) {
                        return;
                    }
                    current.writing = false;
                    if (reactionKey(current.desired) !== sentKey) {
                        flushWrite(id);
                        return;
                    }

                    const latest = messagesByIdRef.current.get(id);
                    if (latest && reactionKey(chatReactions(latest, chatPK, peerChatPK)) === sentKey) {
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
                    if (reactionKey(current.desired) !== sentKey) {
                        flushWrite(id);
                        return;
                    }

                    writesRef.current.delete(id);
                    clearOverride(id);
                    onError?.(error);
                });
        },
        [chatId, chatPK, clearOverride, onError, peerChatPK, scopeKey, updateMessage]
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

            if (reactionKey(chatReactions(message, chatPK, peerChatPK)) === reactionKey(desired)) {
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
            const id = msgId(message);
            if (id && overrides.has(id)) {
                return overrides.get(id) || [];
            }
            return chatReactions(message, chatPK, peerChatPK);
        },
        [chatPK, overrides, peerChatPK]
    );

    const toggleReaction = useCallback(
        (message) => {
            const id = msgId(message);
            if (!id || !chatPK) {
                return [];
            }

            const current = getReactions(message);
            const nextMsg = toggleMsgReaction(setMsgReactions(message, current), chatPK, emoji);
            const desired = chatReactions(nextMsg, chatPK, peerChatPK);
            setOverride(id, desired);

            const currentWrite = writesRef.current.get(id);
            writesRef.current.set(id, {
                ...currentWrite,
                baseMessage: message,
                desired,
                writing: currentWrite?.writing === true,
            });
            flushWrite(id);
            return desired;
        },
        [chatPK, emoji, flushWrite, getReactions, peerChatPK, setOverride]
    );

    return {
        getReactions,
        toggleReaction,
    };
}
