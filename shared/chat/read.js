'use client';

export function clearReadWrite(pendingRead, chatId) {
    const pending = pendingRead?.get?.(chatId);
    if (pending?.timeoutId) {
        clearTimeout(pending.timeoutId);
    }
    pendingRead?.delete?.(chatId);
}

export function clearReadWrites(pendingRead) {
    for (const pending of pendingRead?.values?.() || []) {
        if (pending?.timeoutId) {
            clearTimeout(pending.timeoutId);
        }
    }
    pendingRead?.clear?.();
}

export function scheduleReadReceiptWrite({ pendingRead, chatId, message, lastMsgMs, delay, write, onError }) {
    if (!pendingRead || !chatId || !message) {
        return;
    }

    clearReadWrite(pendingRead, chatId);

    const timeoutId = setTimeout(async () => {
        const pending = pendingRead.get(chatId);
        if (!pending) {
            return;
        }

        pendingRead.delete(chatId);

        try {
            await write(pending);
        } catch (error) {
            onError?.(error);
        }
    }, delay);

    pendingRead.set(chatId, {
        timeoutId,
        target: message.cid || message.id,
        peerChatPK: message.from || message.s,
        lastMsgMs,
    });
}

export function readCandidate({ chatId, chatPK, chatPrivateKey, message, readCache }) {
    if (!chatId || !chatPK || !chatPrivateKey || !message?.id || String(message.id).startsWith('local:')) {
        return null;
    }

    const peerChatPK = message?.from || message?.s || null;
    const target = message?.cid || message?.id || null;
    if (!message?.ts || !target || !peerChatPK || peerChatPK === chatPK || message.pending || message.failed) {
        return null;
    }

    const lastMsgMs = typeof message.ts?.toMillis === 'function' ? message.ts.toMillis() : null;
    if (lastMsgMs == null) {
        return null;
    }

    const guardedUpToMs = readCache?.get?.(chatId);
    if (guardedUpToMs != null && guardedUpToMs >= lastMsgMs) {
        return null;
    }

    return {
        lastMsg: message,
        lastMsgMs,
    };
}

export function markChatsRead(chats, chatId, lastMsg) {
    return chats.map((chatItem) => {
        if (chatItem.id !== chatId) {
            return chatItem;
        }

        const isLastMsg = chatItem.lastMsg?.cid && chatItem.lastMsg.cid === lastMsg.cid;
        return {
            ...chatItem,
            unseen: false,
            lastMsg: isLastMsg ? { ...(chatItem.lastMsg || {}) } : chatItem.lastMsg,
        };
    });
}
