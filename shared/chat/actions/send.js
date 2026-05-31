'use client';

import { useCallback, useRef } from 'react';
import { getChatId } from '../../crypto/chat.js';
import { checkAttachmentSize, getAttachmentType, isAttachmentType, makeAttachmentUnavailableError, makeChatUnavailableError, makeTxtFileAttachment, saveMedia } from '../attachments.js';
import { setLocalChats } from '../chats.js';
import { hasStoredFileRef, isAttachmentMsgType, isLongTxt, makeSharedAttachment } from '../messages.js';
import { usePendingSendQueue } from './pending.js';
import { newMediaStayId, newMediaStayKey, requireMediaSaved } from './save.js';
import { getPeerChatPKFromChatId } from '../ids.js';
import { getMessageKey, makeCid, sortMessages } from '../state.js';
import { cleanChatRetention, getMessageRetention, hasChatRetention, withMessageRetention } from '../ttl.js';
import { cleanText } from '../../utils/text.js';
import { makeTimestamp } from '../../utils/time.js';

export const LOCAL_FAILED = Object.freeze({ pending: false, failed: true });
export const LOCAL_PENDING = Object.freeze({ pending: true, failed: false });
export const LOCAL_SENT = Object.freeze({ pending: false, failed: false });

function replyPatch(message) {
    const replyId = cleanText(message?.r);
    return replyId ? { r: replyId } : {};
}

function retentionPatch(message) {
    return hasChatRetention(message?.retention) ? { retention: cleanChatRetention(message.retention) } : {};
}

function patchCid(message, cid, patch) {
    if (!message?.cid || message.cid !== cid) {
        return message;
    }
    return {
        ...message,
        ...patch,
    };
}

export function makeLocalMessage(chatPK, peerChatPK, message) {
    const chatId = getChatId(chatPK, peerChatPK);
    const cid = message?.cid || makeCid();
    const ms = Date.now();
    const local = {
        ...message,
        s: message?.s || chatPK,
        from: chatPK,
        cid,
        id: `local:${cid}`,
        ts: makeTimestamp(ms),
        pending: true,
        failed: false,
    };

    return { chatId, cid, local, ms };
}

export function addLocalMessage(localByChat, chatId, local) {
    const next = new Map(localByChat);
    const current = next.get(chatId) ?? [];
    next.set(chatId, sortMessages([...current.filter((item) => item.cid !== local.cid), local]));
    return next;
}

export function addLocalMessageToChats(chats, chatId, local, currentLocals = []) {
    return setLocalChats(chats, new Map([[chatId, sortMessages([local, ...currentLocals])]]));
}

export function updateLastChatWithLocal(current, peerChatPK, local, ms) {
    const currentMs = Number(current?.ts || 0);
    if (currentMs > ms) {
        return current;
    }
    return { lastMsg: local, ts: ms, peerChatPK };
}

export function patchLocalMessageMap(localByChat, chatId, cid, patch) {
    const current = localByChat.get(chatId);
    if (!current?.length) {
        return localByChat;
    }

    const next = new Map(localByChat);
    next.set(
        chatId,
        current.map((message) => patchCid(message, cid, patch))
    );
    return next;
}

export function patchChatLastMessage(chats, chatId, cid, patch) {
    return chats.map((chatItem) => {
        if (chatItem.id !== chatId) {
            return chatItem;
        }
        return {
            ...chatItem,
            lastMsg: patchCid(chatItem.lastMsg, cid, patch),
        };
    });
}

export function patchLastChatMessage(current, cid, patch) {
    if (!current?.lastMsg) {
        return current;
    }
    return {
        ...current,
        lastMsg: patchCid(current.lastMsg, cid, patch),
    };
}

export function makeSendCid(message) {
    return message?.cid || makeCid();
}

export function makeSendMessage(chatPK, message) {
    const cid = makeSendCid(message);
    return {
        cid,
        message: {
            ...message,
            s: message?.s || chatPK,
            cid,
        },
    };
}

export function makeLongTxtLocalMessage(chatPK, cid, attachment, message) {
    return {
        t: 'file',
        p: `local:${cid}`,
        k: 'local',
        m: attachment.mimeType,
        z: attachment.size,
        n: attachment.name,
        localData: attachment.data,
        cid,
        s: chatPK,
        ...replyPatch(message),
        ...retentionPatch(message),
    };
}

export function makeSentLongTxtMessage(chatPK, cid, uploaded, message) {
    return {
        ...uploaded,
        cid,
        s: chatPK,
        ...replyPatch(message),
        ...retentionPatch(message),
    };
}

function localUriForAttachment(attachment) {
    return cleanText(attachment?.previewUri) || cleanText(attachment?.localUri);
}

export function prepareAttachment(chatPK, attachment) {
    const size = checkAttachmentSize(attachment);
    const type = getAttachmentType(attachment);
    if (type === 'mp4' && (!Number.isFinite(size) || size <= 0 || !attachment?.data)) {
        throw makeAttachmentUnavailableError(type);
    }

    const cid = makeCid();
    const localUri = localUriForAttachment(attachment);
    const caption = cleanText(attachment?.caption);
    const name = cleanText(attachment?.name);
    const nextAttachment = {
        cid,
        type,
        data: attachment?.data,
        meta: attachment,
    };
    const localMessage = {
        t: type,
        ...(isAttachmentType(type) ? { p: `local:${cid}`, k: 'local' } : {}),
        ...(attachment?.mimeType ? { m: attachment.mimeType } : {}),
        ...(Number.isFinite(attachment?.size) ? { z: attachment.size } : {}),
        ...(Number.isFinite(attachment?.width) ? { w: attachment.width } : {}),
        ...(Number.isFinite(attachment?.height) ? { h: attachment.height } : {}),
        ...(Number.isFinite(attachment?.duration) ? { d: attachment.duration } : {}),
        ...(caption ? { c: caption } : {}),
        ...(name ? { n: name } : {}),
        ...((type === 'img' || type === 'mp3' || type === 'mp4') && localUri ? { localUri } : {}),
        ...(attachment?.data ? { localData: attachment.data } : {}),
        cid,
        s: chatPK,
    };

    return { cid, nextAttachment, localMessage };
}

export function splitRetryMessage(message) {
    const { id, ts, from, pending, failed, localUri, localData, ...payload } = message;
    return { localUri, localData, payload };
}

export function retryAttachmentMeta(message, localUri = '') {
    const caption = cleanText(message?.c);
    const name = cleanText(message?.n);
    return {
        ...(message?.m ? { mimeType: message.m } : {}),
        ...(Number.isFinite(message?.z) ? { size: message.z } : {}),
        ...(Number.isFinite(message?.w) ? { width: message.w } : {}),
        ...(Number.isFinite(message?.h) ? { height: message.h } : {}),
        ...(Number.isFinite(message?.d) ? { duration: message.d } : {}),
        ...(caption ? { caption } : {}),
        ...(name ? { name } : {}),
        ...(localUri ? { localUri } : {}),
    };
}

export function uniqueChatTargets(peerChatPKs) {
    const list = Array.isArray(peerChatPKs) ? peerChatPKs : [peerChatPKs];
    const seen = new Set();
    const targets = [];
    for (const peerChatPK of list) {
        const target = cleanText(peerChatPK);
        if (!target || seen.has(target)) {
            continue;
        }
        seen.add(target);
        targets.push(target);
    }
    return targets;
}

export function shouldUploadPermanentMedia(attachment) {
    return attachment?.permanent === true || attachment?.meta?.permanent === true;
}

export function attachmentWithPermanence(attachment, permanent, stay = null) {
    if (!permanent) {
        return attachment;
    }
    const stayId = cleanText(stay?.id);
    const stayKey = cleanText(stay?.key);
    return {
        ...attachment,
        meta: {
            ...(attachment?.meta || {}),
            permanent: true,
            stay: stayId,
            stayKey,
        },
    };
}

function localMediaAdoptionKey(chatId, cid, message) {
    if (!chatId || !cid || !message?.p || !message?.k || String(message.p).startsWith('local:') || message.k === 'local') {
        return '';
    }
    return `${chatId}\n${cid}\n${message.p}\n${message.k}`;
}

export function useChatSend({ chat, chatBanned, chatPK, chatPrivateKey, localCache, localByChatRef, setLocalByChat, setChats, setLastChat, waitForPeerDelete, sendOptionsForPeer, adoptLocalMessageMedia }) {
    const adoptedLocalMediaRef = useRef(new Set());
    const cachedLocalMediaRef = useRef(new Set());
    const { enqueuePendingSendJob, resetPendingSendQueue } = usePendingSendQueue();

    const resetSending = useCallback(() => {
        resetPendingSendQueue();
        adoptedLocalMediaRef.current.clear();
        cachedLocalMediaRef.current.clear();
    }, [resetPendingSendQueue]);

    const ackMessages = useCallback(
        (chatId, messages) => {
            const acked = new Set((messages || []).map((message) => (typeof message === 'string' ? message : getMessageKey(message))).filter(Boolean));
            if (!chatId || !acked.size) {
                return;
            }

            setLocalByChat((prev) => {
                const locals = prev.get(chatId);
                if (!locals?.length) {
                    return prev;
                }

                const nextLocals = locals.filter((message) => !message.cid || !acked.has(message.cid));
                if (nextLocals.length === locals.length) {
                    return prev;
                }

                const next = new Map(prev);
                if (nextLocals.length) {
                    next.set(chatId, nextLocals);
                } else {
                    next.delete(chatId);
                }
                return next;
            });

            const clearPending = (message) => {
                if (!message?.cid || !acked.has(message.cid)) {
                    return message;
                }
                if (!message.pending && !message.failed) {
                    return message;
                }
                return {
                    ...message,
                    pending: false,
                    failed: false,
                };
            };

            setChats((prev) => {
                let changed = false;
                const next = prev.map((chatItem) => {
                    if (chatItem.id !== chatId) {
                        return chatItem;
                    }
                    const lastMsg = clearPending(chatItem.lastMsg);
                    if (lastMsg === chatItem.lastMsg) {
                        return chatItem;
                    }
                    changed = true;
                    return {
                        ...chatItem,
                        lastMsg,
                    };
                });
                return changed ? next : prev;
            });
            setLastChat((current) => {
                if (!current?.lastMsg?.cid || !acked.has(current.lastMsg.cid)) {
                    return current;
                }
                const lastMsg = clearPending(current.lastMsg);
                if (lastMsg === current.lastMsg) {
                    return current;
                }
                return {
                    ...current,
                    lastMsg,
                };
            });
        },
        [setChats, setLastChat, setLocalByChat]
    );

    const adoptConfirmedMessages = useCallback(
        (chatId, messages) => {
            const locals = localByChatRef.current.get(chatId);
            if (!chatId || !locals?.length || !messages?.length) {
                return messages || [];
            }

            const localByCid = new Map();
            for (const local of locals) {
                if (local?.cid && isAttachmentMsgType(local.t) && (local.localUri || local.localData != null)) {
                    localByCid.set(local.cid, local);
                }
            }
            if (!localByCid.size) {
                return messages;
            }

            let changed = false;
            const nextMessages = messages.map((message) => {
                const local = localByCid.get(message?.cid);
                const stored = isAttachmentMsgType(message?.t) && hasStoredFileRef(message);
                if (!local || !stored) {
                    return message;
                }

                const mediaKey = localMediaAdoptionKey(chatId, message.cid, message);
                if (mediaKey && !cachedLocalMediaRef.current.has(mediaKey) && local.localData != null) {
                    cachedLocalMediaRef.current.add(mediaKey);
                    saveMedia(localCache, message, local.localData, message);
                }
                if (message?.t === 'img' && mediaKey && !adoptedLocalMediaRef.current.has(mediaKey)) {
                    adoptedLocalMediaRef.current.add(mediaKey);
                    adoptLocalMessageMedia?.(message, local);
                }

                if (!local.localUri || message.localUri === local.localUri) {
                    return message;
                }

                changed = true;
                return {
                    ...message,
                    localUri: local.localUri,
                };
            });

            return changed ? nextMessages : messages;
        },
        [adoptLocalMessageMedia, localByChatRef, localCache]
    );

    const rememberCachedLocalMedia = useCallback(
        (peerChatPK, cid, message) => {
            if (!chatPK || !peerChatPK) {
                return;
            }
            const key = localMediaAdoptionKey(getChatId(chatPK, peerChatPK), cid, message);
            if (key) {
                cachedLocalMediaRef.current.add(key);
            }
        },
        [chatPK]
    );

    const showLocalMessage = useCallback(
        (peerChatPK, message) => {
            const { chatId, cid, local, ms } = makeLocalMessage(chatPK, peerChatPK, message);

            setLocalByChat((prev) => addLocalMessage(prev, chatId, local));
            setChats((prev) => addLocalMessageToChats(prev, chatId, local, localByChatRef.current.get(chatId) || []));
            setLastChat((current) => updateLastChatWithLocal(current, peerChatPK, local, ms));

            return { chatId, cid };
        },
        [chatPK, localByChatRef, setChats, setLastChat, setLocalByChat]
    );

    const markLocalStatus = useCallback(
        (chatId, cid, patch) => {
            setLocalByChat((prev) => patchLocalMessageMap(prev, chatId, cid, patch));
            setChats((prev) => patchChatLastMessage(prev, chatId, cid, patch));
            setLastChat((current) => patchLastChatMessage(current, cid, patch));
        },
        [setChats, setLastChat, setLocalByChat]
    );

    const enqueueSendJob = useCallback(
        (peerChatPKs, job, reject) => {
            enqueuePendingSendJob(uniqueChatTargets(peerChatPKs), job, { reject, waitForTarget: waitForPeerDelete });
        },
        [enqueuePendingSendJob, waitForPeerDelete]
    );

    const queueSend = useCallback(
        (peerChatPK, message, run) => {
            const local = showLocalMessage(peerChatPK, message);

            return new Promise((resolve, reject) => {
                const job = {
                    resolve,
                    reject,
                    onSuccess: () => markLocalStatus(local.chatId, local.cid, LOCAL_SENT),
                    onError: () => markLocalStatus(local.chatId, local.cid, LOCAL_FAILED),
                    run,
                };

                enqueueSendJob(peerChatPK, job, reject);
            });
        },
        [enqueueSendJob, markLocalStatus, showLocalMessage]
    );

    const sendMessage = useCallback(
        async (peerChatPK, message) => {
            if (chatBanned) {
                throw makeChatUnavailableError();
            }
            if (!chatPK || !chatPrivateKey || !peerChatPK) {
                throw makeChatUnavailableError();
            }
            const sendOptions = sendOptionsForPeer(peerChatPK);
            const nextMessage = withMessageRetention(message, sendOptions.retention);
            if (isLongTxt(nextMessage)) {
                const cid = makeSendCid(nextMessage);
                const attachment = makeTxtFileAttachment(nextMessage);
                const localMessage = makeLongTxtLocalMessage(chatPK, cid, attachment, nextMessage);

                return queueSend(peerChatPK, localMessage, async () => {
                    const uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, peerChatPK, { cid, ...attachment, meta: attachment });
                    saveMedia(localCache, uploaded, attachment.data, attachment);
                    rememberCachedLocalMedia(peerChatPK, cid, uploaded);
                    await chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, makeSentLongTxtMessage(chatPK, cid, uploaded, nextMessage), sendOptions);
                });
            }

            const queued = makeSendMessage(chatPK, nextMessage);
            return queueSend(peerChatPK, queued.message, async () => {
                return chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, queued.message, sendOptions);
            });
        },
        [chat, chatBanned, chatPK, chatPrivateKey, localCache, queueSend, rememberCachedLocalMedia, sendOptionsForPeer]
    );

    const retryMessage = useCallback(
        (chatId, cid) => {
            if (chatBanned || !chatPK || !chatPrivateKey || !chatId || !cid) {
                return;
            }

            const locals = localByChatRef.current.get(chatId);
            const failedMsg = locals?.find((m) => m.cid === cid && m.failed);
            if (!failedMsg) {
                return;
            }

            const peerChatPK = getPeerChatPKFromChatId(chatId, chatPK);
            if (!peerChatPK) {
                return;
            }

            markLocalStatus(chatId, cid, LOCAL_PENDING);

            const { localUri, localData, payload } = splitRetryMessage(failedMsg);
            const baseSendOptions = sendOptionsForPeer(peerChatPK);
            const retryRetention = getMessageRetention(failedMsg, baseSendOptions.retention);
            const sendOptions = { ...baseSendOptions, retention: retryRetention };

            if (isAttachmentType(failedMsg?.t) && localData) {
                const meta = retryAttachmentMeta(failedMsg, localUri);

                return new Promise((resolve, reject) => {
                    const job = {
                        resolve,
                        reject,
                        onSuccess: () => markLocalStatus(chatId, cid, LOCAL_SENT),
                        onError: () => markLocalStatus(chatId, cid, LOCAL_FAILED),
                        run: async () => {
                            const uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, peerChatPK, {
                                cid,
                                type: failedMsg.t,
                                data: localData,
                                meta,
                            });
                            saveMedia(localCache, uploaded, localData, meta);
                            rememberCachedLocalMedia(peerChatPK, cid, uploaded);
                            await chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, withMessageRetention({ ...uploaded, cid, s: chatPK }, retryRetention), sendOptions);
                        },
                    };

                    enqueueSendJob(peerChatPK, job, reject);
                });
            }

            return new Promise((resolve, reject) => {
                const job = {
                    resolve,
                    reject,
                    onSuccess: () => markLocalStatus(chatId, cid, LOCAL_SENT),
                    onError: () => markLocalStatus(chatId, cid, LOCAL_FAILED),
                    run: async () => {
                        return chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, withMessageRetention(payload, retryRetention), sendOptions);
                    },
                };

                enqueueSendJob(peerChatPK, job, reject);
            });
        },
        [chat, chatBanned, chatPK, chatPrivateKey, enqueueSendJob, localByChatRef, localCache, markLocalStatus, rememberCachedLocalMedia, sendOptionsForPeer]
    );

    const sendAttachment = useCallback(
        async (peerChatPK, attachment) => {
            if (chatBanned) {
                throw makeChatUnavailableError();
            }
            if (!chatPK || !chatPrivateKey || !peerChatPK) {
                throw makeChatUnavailableError();
            }
            const { cid, nextAttachment, localMessage } = prepareAttachment(chatPK, attachment);
            const permanent = shouldUploadPermanentMedia(attachment);
            const stay = permanent ? { id: newMediaStayId(), key: newMediaStayKey() } : null;
            const uploadAttachment = attachmentWithPermanence(nextAttachment, permanent, stay);
            const sendOptions = sendOptionsForPeer(peerChatPK);
            const localPayload = withMessageRetention(localMessage, sendOptions.retention);

            return queueSend(peerChatPK, localPayload, async () => {
                const uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, peerChatPK, uploadAttachment);
                let savedMedia = false;
                try {
                    if (permanent) {
                        await requireMediaSaved(chat, uploaded.p, stay, true);
                        savedMedia = true;
                    }
                    saveMedia(localCache, uploaded, attachment?.data, attachment);
                    rememberCachedLocalMedia(peerChatPK, cid, uploaded);
                    await chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, withMessageRetention({ ...uploaded, cid, s: chatPK }, sendOptions.retention), sendOptions);
                } catch (error) {
                    if (savedMedia) {
                        await requireMediaSaved(chat, uploaded.p, stay, false).catch(() => {});
                    }
                    throw error;
                }
            });
        },
        [chat, chatBanned, chatPK, chatPrivateKey, localCache, queueSend, rememberCachedLocalMedia, sendOptionsForPeer]
    );

    const sendImage = useCallback((peerChatPK, image) => sendAttachment(peerChatPK, { ...image, type: 'img' }), [sendAttachment]);

    const sendAttachmentMany = useCallback(
        async (peerChatPKs, attachment) => {
            if (chatBanned) {
                throw makeChatUnavailableError();
            }

            const targets = uniqueChatTargets(peerChatPKs);
            if (!targets.length) {
                return [];
            }

            if (!chatPK || !chatPrivateKey) {
                throw makeChatUnavailableError();
            }

            const locals = targets.map((peerChatPK) => {
                const prepared = prepareAttachment(chatPK, attachment);
                const permanent = shouldUploadPermanentMedia(attachment);
                const sendOptions = sendOptionsForPeer(peerChatPK);
                const localMessage = withMessageRetention(prepared.localMessage, sendOptions.retention);
                const local = showLocalMessage(peerChatPK, localMessage);
                const stay = permanent ? { id: newMediaStayId(), key: newMediaStayKey() } : null;
                return {
                    peerChatPK,
                    cid: prepared.cid,
                    chatId: local.chatId,
                    sendOptions,
                    permanent,
                    stay,
                    nextAttachment: attachmentWithPermanence(prepared.nextAttachment, permanent, stay),
                };
            });

            return new Promise((resolve, reject) => {
                const job = {
                    resolve,
                    reject,
                    onError: () => {
                        for (const item of locals) {
                            markLocalStatus(item.chatId, item.cid, LOCAL_FAILED);
                        }
                    },
                    run: async () => {
                        const results = [];
                        const uploads = new Map();
                        const uploadErrors = new Map();

                        for (const item of locals) {
                            const uploadKey = item.permanent ? 'permanent' : 'expiring';
                            const uploadError = uploadErrors.get(uploadKey);
                            if (uploadError) {
                                markLocalStatus(item.chatId, item.cid, LOCAL_FAILED);
                                results.push({ peerChatPK: item.peerChatPK, ok: false, error: uploadError });
                                continue;
                            }

                            let savedMedia = false;
                            try {
                                let uploaded = uploads.get(uploadKey);
                                if (!uploaded) {
                                    uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, item.peerChatPK, item.nextAttachment);
                                    uploads.set(uploadKey, uploaded);
                                    saveMedia(localCache, uploaded, attachment?.data, attachment);
                                }
                                if (item.permanent) {
                                    await requireMediaSaved(chat, uploaded.p, item.stay, true);
                                    savedMedia = true;
                                }

                                const sent = {
                                    ...uploaded,
                                    ...(item.permanent ? { stay: item.stay.id, stayKey: item.stay.key } : {}),
                                    cid: item.cid,
                                    s: chatPK,
                                };
                                const sentMessage = withMessageRetention(sent, item.sendOptions.retention);
                                rememberCachedLocalMedia(item.peerChatPK, item.cid, sentMessage);
                                await chat.sendMessage(chatPK, chatPrivateKey, item.peerChatPK, sentMessage, item.sendOptions);
                                markLocalStatus(item.chatId, item.cid, LOCAL_SENT);
                                results.push({ peerChatPK: item.peerChatPK, ok: true, message: sentMessage });
                            } catch (error) {
                                const uploaded = uploads.get(uploadKey);
                                if (savedMedia && uploaded?.p) {
                                    await requireMediaSaved(chat, uploaded.p, item.stay, false).catch(() => {});
                                }
                                if (!uploads.has(uploadKey)) {
                                    uploadErrors.set(uploadKey, error);
                                }
                                markLocalStatus(item.chatId, item.cid, LOCAL_FAILED);
                                results.push({ peerChatPK: item.peerChatPK, ok: false, error });
                            }
                        }

                        return results;
                    },
                };

                enqueueSendJob(targets, job, reject);
            });
        },
        [chat, chatBanned, chatPK, chatPrivateKey, enqueueSendJob, localCache, markLocalStatus, rememberCachedLocalMedia, sendOptionsForPeer, showLocalMessage]
    );

    const sendImageMany = useCallback((peerChatPKs, image) => sendAttachmentMany(peerChatPKs, { ...image, type: 'img' }), [sendAttachmentMany]);

    const shareAttachment = useCallback(
        async (peerChatPK, message) => {
            if (chatBanned) {
                throw makeChatUnavailableError();
            }
            if (!chatPK || !chatPrivateKey || !peerChatPK) {
                throw makeChatUnavailableError();
            }
            const sendOptions = sendOptionsForPeer(peerChatPK);
            const shared = withMessageRetention(makeSharedAttachment(message), sendOptions.retention);
            const queued = makeSendMessage(chatPK, shared);
            return queueSend(peerChatPK, queued.message, async () => {
                return chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, queued.message, sendOptions);
            });
        },
        [chat, chatBanned, chatPK, chatPrivateKey, queueSend, sendOptionsForPeer]
    );

    return {
        resetSending,
        ackMessages,
        adoptConfirmedMessages,
        sendMessage,
        retryMessage,
        sendAttachment,
        sendImage,
        sendAttachmentMany,
        sendImageMany,
        shareAttachment,
    };
}
