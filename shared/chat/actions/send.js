'use client';

import { useCallback, useRef } from 'react';
import { attachmentBytes, checkAttachmentSize, getAttachmentType, isAttachmentType, makeAttachmentUnavailableError, makeChatUnavailableError, makeTxtFileAttachment, saveMedia } from '../attachments.js';
import { setLocalChats } from '../chats.js';
import { hasSharedMediaFileRef, hasStoredFileRef, isAttachmentMsgType, isLongTxt, makeSharedAttachment } from '../messages.js';
import { putSharedAttachment } from '../media.js';
import { usePendingSendQueue } from './pending.js';
import { getPeerChatPKFromChatId } from '../ids.js';
import { resolveLinkId } from '../pairs.js';
import { sendMsg, uploadAttachmentMsg } from '../messages/write.js';
import { getMessageKey, makeCid, sortMessages } from '../state.js';
import { getMessageRetention, retentionPatch, withMessageRetention } from '../ttl.js';
import { cleanText } from '../../utils/text.js';
import { makeTimestamp } from '../../utils/time.js';

export const LOCAL_FAILED = Object.freeze({ pending: false, failed: true });
export const LOCAL_PENDING = Object.freeze({ pending: true, failed: false });
export const LOCAL_SENT = Object.freeze({ pending: false, failed: false });

function replyPatch(message) {
    const replyId = cleanText(message?.r);
    return replyId ? { r: replyId } : {};
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

export function makeLocalMessage(chatId, chatPK, peerChatPK, message) {
    const cid = message?.cid || makeCid();
    const ms = Date.now();
    const local = {
        ...message,
        s: message?.s || chatPK,
        from: chatPK,
        peerChatPK,
        cid,
        id: `local:${cid}`,
        ts: makeTimestamp(ms),
        pending: true,
        failed: false,
    };

    return { chatId, cid, local, ms };
}

async function resolvePeerChat(cloud, chatPK, chatPrivateKey, peerChatPK, options = {}) {
    const existingChatId = cleanText(options?.chatId);
    const existingLinkId = cleanText(options?.linkId);
    if (existingChatId && existingLinkId) {
        return { chatId: existingChatId, linkId: existingLinkId, version: Number.isInteger(options?.linkVersion) ? options.linkVersion : 0, exists: true };
    }

    const linkId = existingLinkId || await resolveLinkId(chatPK, chatPrivateKey, peerChatPK);
    if (!linkId || typeof cloud?.chat?.links?.open !== 'function') {
        throw makeChatUnavailableError();
    }
    const linkChat = await cloud.chat.links.open(linkId);
    const chatId = cleanText(linkChat?.id);
    if (!chatId) {
        throw makeChatUnavailableError();
    }
    return {
        chatId,
        linkId,
        version: Number.isInteger(linkChat?.version) ? linkChat.version : 0,
        exists: linkChat?.exists === true,
    };
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
    const { id, ts, from, pending, failed, localUri, localData, peerChatPK, chatId, linkId, linkVersion, version, ...payload } = message;
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

function localMediaAdoptionKey(chatId, cid, message) {
    if (!chatId || !cid || !message?.p || !message?.k || String(message.p).startsWith('local:') || message.k === 'local') {
        return '';
    }
    return `${chatId}\n${cid}\n${message.p}\n${message.k}`;
}

function sendableMessage(message) {
    const { localData, localUri, pending, failed, peerChatPK, id, from, ts, chatId, linkId, linkVersion, version, ...payload } = message || {};
    return payload;
}

function withMediaUpload(cloud, media, attachment = {}) {
    const uploadChatMedia = media?.uploadChatMedia || cloud?.chat?.media?.upload;
    if (typeof uploadChatMedia !== 'function') {
        return attachment;
    }
    return {
        ...attachment,
        meta: {
            ...(attachment?.meta || {}),
            uploadChatMedia,
        },
    };
}

function withSharedMediaUpload(cloud, media, meta = {}) {
    const uploadSharedMedia = media?.uploadSharedMedia || cloud?.chat?.media?.uploadShared;
    if (typeof uploadSharedMedia !== 'function') {
        return meta;
    }
    return {
        ...meta,
        uploadSharedMedia,
    };
}

function uploadMessageAttachment(cloud, media, senderPubkey, senderPrivkey, receiverChatPK, attachment = {}) {
    if (typeof media?.uploadAttachment === 'function') {
        return media.uploadAttachment(senderPubkey, senderPrivkey, receiverChatPK, attachment);
    }
    return uploadAttachmentMsg(cloud, senderPubkey, senderPrivkey, receiverChatPK, withMediaUpload(cloud, media, attachment));
}

async function makeSharedMediaAttachment(cloud, media, message, data) {
    const source = makeSharedAttachment(message);
    if (hasSharedMediaFileRef(source)) {
        return source;
    }
    const bytes = await attachmentBytes(data);
    if (!bytes?.byteLength) {
        throw makeChatUnavailableError();
    }
    return putSharedAttachment(source.t, bytes, withSharedMediaUpload(cloud, media, {
        ...(source?.m ? { mimeType: source.m } : {}),
        ...(Number.isFinite(source?.z) ? { size: source.z } : { size: bytes.byteLength }),
        ...(Number.isFinite(source?.w) ? { width: source.w } : {}),
        ...(Number.isFinite(source?.h) ? { height: source.h } : {}),
        ...(Number.isFinite(source?.d) ? { duration: source.d } : {}),
        ...(source?.n ? { name: source.n } : {}),
        ...(source?.c ? { caption: source.c } : {}),
    }));
}

export function useChatSend({ cloud, media = {}, uid, chatBanned, chatPK, chatPrivateKey, localCache, localByChatRef, setLocalByChat, setChats, setLastChat, waitForPeerDelete, sendOptionsForPeer, selectLocalChat, adoptLocalMessageMedia, readMessageFile }) {
    const adoptedLocalMediaRef = useRef(new Set());
    const cachedLocalMediaRef = useRef(new Set());
    const sentChatIdsRef = useRef(new Set());
    const { enqueuePendingSendJob, resetPendingSendQueue } = usePendingSendQueue();

    const resetSending = useCallback(() => {
        resetPendingSendQueue();
        adoptedLocalMediaRef.current.clear();
        cachedLocalMediaRef.current.clear();
        sentChatIdsRef.current.clear();
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
        (chatId, cid, message) => {
            if (!chatId) {
                return;
            }
            const key = localMediaAdoptionKey(chatId, cid, message);
            if (key) {
                cachedLocalMediaRef.current.add(key);
            }
        },
        []
    );

    const resolvePeerChatForSend = useCallback(
        async (peerChatPK, options = {}) => {
            if (!chatPK || !chatPrivateKey || !peerChatPK) {
                throw makeChatUnavailableError();
            }
            return resolvePeerChat(cloud, chatPK, chatPrivateKey, peerChatPK, options);
        },
        [cloud, chatPK, chatPrivateKey]
    );

    const showLocalMessage = useCallback(
        async (peerChatPK, message, options = {}) => {
            const chat = await resolvePeerChatForSend(peerChatPK, options);
            const chatId = chat.chatId;
            const { cid, local, ms } = makeLocalMessage(chatId, chatPK, peerChatPK, message);
            local.linkId = chat.linkId;

            setLocalByChat((prev) => addLocalMessage(prev, chatId, local));
            setChats((prev) => addLocalMessageToChats(prev, chatId, local, localByChatRef.current.get(chatId) || []));
            setLastChat((current) => updateLastChatWithLocal(current, peerChatPK, local, ms));
            selectLocalChat?.(peerChatPK, chatId);

            return { ...chat, cid };
        },
        [chatPK, localByChatRef, resolvePeerChatForSend, selectLocalChat, setChats, setLastChat, setLocalByChat]
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
        async (peerChatPK, message, run, { lastMsgRequired = false } = {}) => {
            const local = await showLocalMessage(peerChatPK, message, sendOptionsForPeer(peerChatPK));

            return new Promise((resolve, reject) => {
                const job = {
                    lastMsgKey: local.chatId,
                    lastMsgRequired,
                    resolve,
                    reject,
                    onSuccess: () => {
                        sentChatIdsRef.current.add(local.chatId);
                        markLocalStatus(local.chatId, local.cid, LOCAL_SENT);
                    },
                    onError: () => markLocalStatus(local.chatId, local.cid, LOCAL_FAILED),
                    run: (context) => run({ ...context, local }),
                };

                enqueueSendJob(peerChatPK, job, reject);
            });
        },
        [enqueueSendJob, markLocalStatus, sendOptionsForPeer, showLocalMessage]
    );

    const sendOptionsForQueuedWrite = useCallback((baseOptions, local, updateLastMsg) => {
        const chatId = local?.chatId;
        const chatExists = baseOptions?.chatExists === true || sentChatIdsRef.current.has(chatId);
        return {
            ...baseOptions,
            chatId,
            linkId: local?.linkId || baseOptions?.linkId,
            linkVersion: local?.version || baseOptions?.linkVersion,
            senderUid: uid,
            chatExists,
            updateLastMsg: !chatExists || updateLastMsg !== false,
        };
    }, [uid]);

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

                return queueSend(peerChatPK, localMessage, async ({ local, updateLastMsg }) => {
                    const writeOptions = sendOptionsForQueuedWrite(sendOptions, local, updateLastMsg);
                    const uploaded = await uploadMessageAttachment(cloud, media, chatPK, chatPrivateKey, peerChatPK, { cid, ...attachment, chatId: local.chatId, meta: { ...attachment, chatId: local.chatId } });
                    saveMedia(localCache, uploaded, attachment.data, attachment);
                    rememberCachedLocalMedia(local.chatId, cid, uploaded);
                    return sendMsg(cloud, chatPK, chatPrivateKey, peerChatPK, makeSentLongTxtMessage(chatPK, cid, uploaded, nextMessage), writeOptions);
                }, { lastMsgRequired: sendOptions.chatExists !== true });
            }

            const queued = makeSendMessage(chatPK, nextMessage);
            return queueSend(peerChatPK, queued.message, async ({ local, updateLastMsg }) => {
                return sendMsg(cloud, chatPK, chatPrivateKey, peerChatPK, queued.message, sendOptionsForQueuedWrite(sendOptions, local, updateLastMsg));
            }, { lastMsgRequired: sendOptions.chatExists !== true });
        },
        [cloud, media, chatBanned, chatPK, chatPrivateKey, localCache, queueSend, rememberCachedLocalMedia, sendOptionsForPeer, sendOptionsForQueuedWrite]
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

            const peerChatPK = failedMsg.peerChatPK || getPeerChatPKFromChatId(chatId, chatPK);
            if (!peerChatPK) {
                return;
            }

            markLocalStatus(chatId, cid, LOCAL_PENDING);

            const { localUri, localData, payload } = splitRetryMessage(failedMsg);
            const baseSendOptions = sendOptionsForPeer(peerChatPK);
            const retryRetention = getMessageRetention(failedMsg, baseSendOptions.retention);
            const sendOptions = {
                ...baseSendOptions,
                chatId,
                linkId: failedMsg.linkId || baseSendOptions.linkId,
                linkVersion: failedMsg.version || baseSendOptions.linkVersion,
                retention: retryRetention,
                senderUid: uid,
            };

            if (isAttachmentType(failedMsg?.t) && localData) {
                const meta = retryAttachmentMeta(failedMsg, localUri);

                return new Promise((resolve, reject) => {
                    const job = {
                        resolve,
                        reject,
                        onSuccess: () => markLocalStatus(chatId, cid, LOCAL_SENT),
                        onError: () => markLocalStatus(chatId, cid, LOCAL_FAILED),
                        run: async () => {
                            const uploaded = await uploadMessageAttachment(cloud, media, chatPK, chatPrivateKey, peerChatPK, {
                                cid,
                                type: failedMsg.t,
                                data: localData,
                                chatId,
                                meta: { ...meta, chatId },
                            });
                            saveMedia(localCache, uploaded, localData, meta);
                            rememberCachedLocalMedia(chatId, cid, uploaded);
                            await sendMsg(cloud, chatPK, chatPrivateKey, peerChatPK, withMessageRetention({ ...uploaded, cid, s: chatPK }, retryRetention), sendOptions);
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
                        return sendMsg(cloud, chatPK, chatPrivateKey, peerChatPK, withMessageRetention(payload, retryRetention), sendOptions);
                    },
                };

                enqueueSendJob(peerChatPK, job, reject);
            });
        },
        [cloud, media, chatBanned, chatPK, chatPrivateKey, enqueueSendJob, localByChatRef, localCache, markLocalStatus, rememberCachedLocalMedia, sendOptionsForPeer, uid]
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
            const sendOptions = sendOptionsForPeer(peerChatPK);
            const localPayload = withMessageRetention(localMessage, sendOptions.retention);

            return queueSend(peerChatPK, localPayload, async ({ local, updateLastMsg }) => {
                const writeOptions = sendOptionsForQueuedWrite(sendOptions, local, updateLastMsg);
                const uploaded = await uploadMessageAttachment(cloud, media, chatPK, chatPrivateKey, peerChatPK, { ...nextAttachment, chatId: local.chatId, meta: { ...(nextAttachment.meta || {}), chatId: local.chatId } });
                saveMedia(localCache, uploaded, attachment?.data, attachment);
                rememberCachedLocalMedia(local.chatId, cid, uploaded);
                return sendMsg(cloud, chatPK, chatPrivateKey, peerChatPK, withMessageRetention({ ...uploaded, cid, s: chatPK }, sendOptions.retention), writeOptions);
            }, { lastMsgRequired: sendOptions.chatExists !== true });
        },
        [cloud, media, chatBanned, chatPK, chatPrivateKey, localCache, queueSend, rememberCachedLocalMedia, sendOptionsForPeer, sendOptionsForQueuedWrite]
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

            const locals = await Promise.all(targets.map(async (peerChatPK) => {
                const prepared = prepareAttachment(chatPK, attachment);
                const sendOptions = sendOptionsForPeer(peerChatPK);
                const localMessage = withMessageRetention(prepared.localMessage, sendOptions.retention);
                const local = await showLocalMessage(peerChatPK, localMessage, sendOptions);
                return {
                    peerChatPK,
                    cid: prepared.cid,
                    chatId: local.chatId,
                    linkId: local.linkId,
                    version: local.version,
                    sendOptions,
                    nextAttachment: prepared.nextAttachment,
                };
            }));

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
                            const uploadKey = item.chatId;
                            const uploadError = uploadErrors.get(uploadKey);
                            if (uploadError) {
                                markLocalStatus(item.chatId, item.cid, LOCAL_FAILED);
                                results.push({ peerChatPK: item.peerChatPK, ok: false, error: uploadError });
                                continue;
                            }

                            try {
                                let uploaded = uploads.get(uploadKey);
                                if (!uploaded) {
                                    uploaded = await uploadMessageAttachment(cloud, media, chatPK, chatPrivateKey, item.peerChatPK, { ...item.nextAttachment, chatId: item.chatId, meta: { ...(item.nextAttachment.meta || {}), chatId: item.chatId } });
                                    uploads.set(uploadKey, uploaded);
                                    saveMedia(localCache, uploaded, attachment?.data, attachment);
                                }

                                const sent = {
                                    ...uploaded,
                                    cid: item.cid,
                                    s: chatPK,
                                };
                                const sentMessage = withMessageRetention(sent, item.sendOptions.retention);
                                rememberCachedLocalMedia(item.chatId, item.cid, sentMessage);
                                await sendMsg(cloud, chatPK, chatPrivateKey, item.peerChatPK, sentMessage, { ...item.sendOptions, chatId: item.chatId, linkId: item.linkId, senderUid: uid });
                                markLocalStatus(item.chatId, item.cid, LOCAL_SENT);
                                results.push({ peerChatPK: item.peerChatPK, ok: true, message: sentMessage });
                            } catch (error) {
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
        [cloud, media, chatBanned, chatPK, chatPrivateKey, enqueueSendJob, localCache, markLocalStatus, rememberCachedLocalMedia, sendOptionsForPeer, showLocalMessage, uid]
    );

    const sendImageMany = useCallback((peerChatPKs, image) => sendAttachmentMany(peerChatPKs, { ...image, type: 'img' }), [sendAttachmentMany]);

    const resolveSharePayload = useCallback(
        async (message, options = {}) => {
            if (chatBanned) {
                throw makeChatUnavailableError();
            }
            if (!chatPK || !chatPrivateKey) {
                throw makeChatUnavailableError();
            }
            const sourcePeerChatPK = cleanText(options?.sourcePeerChatPK) || cleanText(message?.peerChatPK) || (message?.s && message.s !== chatPK ? cleanText(message.s) : '');
            let data = options?.data ?? options?.bytes ?? message?.localData;
            if (!hasSharedMediaFileRef(message)) {
                const bytes = await attachmentBytes(data);
                data = bytes?.byteLength ? bytes : null;
                if (!data && sourcePeerChatPK && typeof readMessageFile === 'function') {
                    data = await readMessageFile(sourcePeerChatPK, message);
                }
            }
            return makeSharedMediaAttachment(cloud, media, message, data);
        },
        [chatBanned, chatPK, chatPrivateKey, cloud, media, readMessageFile]
    );

    const sendSharedAttachment = useCallback(
        async (peerChatPK, sharedMessage) => {
            const sendOptions = sendOptionsForPeer(peerChatPK);
            const cid = makeCid();
            const message = withMessageRetention({ ...sharedMessage, cid, s: chatPK }, sendOptions.retention);
            return queueSend(peerChatPK, message, async ({ local, updateLastMsg }) => {
                const writeOptions = sendOptionsForQueuedWrite(sendOptions, local, updateLastMsg);
                if (sharedMessage?.localData != null) {
                    saveMedia(localCache, message, sharedMessage.localData, message);
                    rememberCachedLocalMedia(local.chatId, cid, message);
                }
                return sendMsg(cloud, chatPK, chatPrivateKey, peerChatPK, sendableMessage(message), writeOptions);
            }, { lastMsgRequired: sendOptions.chatExists !== true });
        },
        [chatPK, chatPrivateKey, cloud, localCache, queueSend, rememberCachedLocalMedia, sendOptionsForPeer, sendOptionsForQueuedWrite]
    );

    const share = useCallback(
        async (peerChatPKs, message, options = {}) => {
            const targets = uniqueChatTargets(peerChatPKs);
            if (!targets.length) {
                return [];
            }
            const sharedMessage = await resolveSharePayload(message, options);
            const payload = {
                ...sharedMessage,
                ...(options?.data != null ? { localData: options.data } : {}),
            };
            const results = [];
            for (const peerChatPK of targets) {
                try {
                    results.push({ peerChatPK, ok: true, result: await sendSharedAttachment(peerChatPK, payload) });
                } catch (error) {
                    results.push({ peerChatPK, ok: false, error });
                }
            }
            return results;
        },
        [resolveSharePayload, sendSharedAttachment]
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
        share,
    };
}
