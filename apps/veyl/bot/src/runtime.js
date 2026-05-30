import {
    BOT_ACTION_STATUS_DONE,
    BOT_ACTION_STATUS_ERROR,
    BOT_ACTION_STATUS_QUEUED,
    BOT_ACTION_STATUS_RUNNING,
    BOT_ACTION_TYPE_BURST,
    BOT_MODE,
    BOT_RUNTIME_ACTIONS,
    BOT_RUNTIME_DOC_ID,
    BOT_RUNTIME_LEASE_MS,
    BOT_UNDERFUNDED_TEXT,
} from '@glyphteck/shared/bot/events';
import { bootBotAccount, closeBotAccount } from '@glyphteck/shared/bot/account';
import { clearBotChatPairCache, decryptBotChatSettings, decryptBotMsg, hasBotMsg, readBotMsgAttachment, sendBotMsg, updateBotMsg, uploadBotAttachmentMsg } from '@glyphteck/shared/bot/chat';
import { getBotBalance, mirrorBotTransfer } from '@glyphteck/shared/bot/wallet';
import { isControlMsg, isSystemMsg, makeHiddenCheckpoint, makeReadReceipt, makeReq, makeTxt, setReqTx } from '@glyphteck/shared/chat/messages';
import { makeCid } from '@glyphteck/shared/chat/state';
import { getChatId } from '@glyphteck/shared/crypto/chat';
import {
    BOT_BURST_DEFAULT_COUNT,
    BOT_BURST_DEFAULT_DELAY_MS,
    BOT_BURST_MAX_COUNT,
    BOT_BURST_MIN_DELAY_MS,
    BOT_BURST_SESSION_WAIT_MS,
    BOT_REPLY_AFTER_READ_DELAY_MS,
} from '@glyphteck/shared/config';
import { resolveNetwork } from '@glyphteck/shared/network';
import { resolveWalletPK } from '@glyphteck/shared/wallet/keys';
import { SparkWallet, SparkWalletEvent } from '@buildonspark/spark-sdk';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import admin, { db, FieldValue, Timestamp, projectId } from './admin.js';
import { createSecretClient, readBotSeed } from './secrets.js';

const SPARK_NETWORK = resolveNetwork(process.env);
const VERBOSE = process.env.VEYL_VERBOSE === '1';
const MAX_BOT_PEER_CACHE = 512;
const MAX_BOT_READ_CACHE = 2048;
const BOT_READS = 'reads';
const RUNTIME_HEARTBEAT_MS = 15000;
const RUNTIME_ACTIONS_SUPPORTED = Object.freeze([BOT_ACTION_TYPE_BURST]);
const BURST_READ_RECEIPT_SCAN_LIMIT = 100;
const TRANSIENT_CONNECTION_CODES = new Set([
    4,
    14,
    '4',
    '14',
    'DEADLINE_EXCEEDED',
    'UNAVAILABLE',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNABORTED',
    'EAI_AGAIN',
    'ENOTFOUND',
]);
const TRANSIENT_CONNECTION_PATTERN =
    /\b(DEADLINE_EXCEEDED|UNAVAILABLE|ETIMEDOUT|ECONNRESET|ECONNABORTED|EAI_AGAIN|ENOTFOUND)\b/i;

function cleanDocPart(value) {
    return String(value ?? '')
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, '_')
        .slice(0, 120);
}

function botReplyId(context, kind = 'reply') {
    const msgId = cleanDocPart(context?.msgId);
    const part = cleanDocPart(kind) || 'reply';
    if (!msgId) {
        return '';
    }
    return `bot_${part}_${msgId}`;
}

function botReplyCid(context, kind = 'reply') {
    const ms = Math.max(1, tsMs(context?.msgTs));
    const base = ms.toString(36);
    const suffix = cleanDocPart(`${kind}${context?.msgId || ''}`)
        .padEnd(6, '0')
        .slice(0, 6);
    return `${base}${suffix}`;
}

function verboseLog(...args) {
    if (VERBOSE) {
        console.log(...args);
    }
}

function tsMs(value) {
    if (typeof value?.toMillis === 'function') {
        return value.toMillis();
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    const ms = Number(value);
    return Number.isFinite(ms) ? ms : 0;
}

function hasAttachment(msg) {
    return typeof msg?.p === 'string' && !!msg.p && typeof msg?.k === 'string' && !!msg.k;
}

function attachmentMeta(msg) {
    return {
        ...(msg?.m ? { m: msg.m } : {}),
        ...(Number.isFinite(msg?.z) ? { z: msg.z } : {}),
        ...(Number.isFinite(msg?.w) ? { w: msg.w } : {}),
        ...(Number.isFinite(msg?.h) ? { h: msg.h } : {}),
        ...(Number.isFinite(msg?.d) ? { d: msg.d } : {}),
        ...(msg?.n ? { n: msg.n } : {}),
        ...(typeof msg?.c === 'string' && msg.c.trim() ? { c: msg.c.trim() } : {}),
    };
}

function cleanPayload(message) {
    const payload = { ...(message || {}) };
    delete payload.id;
    delete payload.ts;
    delete payload.from;
    delete payload.s;
    delete payload.cid;
    delete payload.retention;
    return payload;
}

function sameKey(left, right) {
    return (
        String(left ?? '')
            .trim()
            .toLowerCase() ===
        String(right ?? '')
            .trim()
            .toLowerCase()
    );
}

function statusMessage(error) {
    return error?.message || String(error || 'unknown error');
}

function isTransientConnectionError(error) {
    const code = error?.code;
    if (TRANSIENT_CONNECTION_CODES.has(code) || TRANSIENT_CONNECTION_CODES.has(String(code).toUpperCase())) {
        return true;
    }
    const message = statusMessage(error);
    return TRANSIENT_CONNECTION_PATTERN.test(message) || /transport (?:errored|error)/i.test(message);
}

function connectionStatus(error) {
    const message = statusMessage(error);
    const match = message.match(TRANSIENT_CONNECTION_PATTERN);
    if (match?.[1]) {
        return match[1].toUpperCase();
    }
    return error?.code != null ? `code ${error.code}` : 'network unavailable';
}

function logHeartbeatError(error) {
    if (isTransientConnectionError(error)) {
        console.warn(`bot runtime heartbeat lost connection: ${connectionStatus(error)}`);
        return;
    }
    console.error('bot runtime heartbeat failed', error);
}

function queueMapJob(map, key, job) {
    const previous = map.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(job);

    let tracked = null;
    tracked = run.finally(() => {
        if (map.get(key) === tracked) {
            map.delete(key);
        }
    });

    map.set(key, tracked);
    return tracked;
}

function setLimitedMap(map, key, value, max) {
    if (!map || !key) {
        return;
    }

    if (map.has(key)) {
        map.delete(key);
    }
    map.set(key, value);

    while (map.size > max) {
        const firstKey = map.keys().next().value;
        if (!firstKey) {
            return;
        }
        map.delete(firstKey);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function runtimeRef() {
    return db.collection('runtimes').doc(BOT_RUNTIME_DOC_ID);
}

function cleanBurstCount(value) {
    const count = Number(value ?? BOT_BURST_DEFAULT_COUNT);
    if (!Number.isInteger(count) || count <= 0 || count > BOT_BURST_MAX_COUNT) {
        throw new Error(`burst count must be an integer from 1 to ${BOT_BURST_MAX_COUNT}`);
    }
    return count;
}

function cleanBurstDelayMs(value) {
    const delayMs = Number(value ?? BOT_BURST_DEFAULT_DELAY_MS);
    if (!Number.isFinite(delayMs) || delayMs < BOT_BURST_MIN_DELAY_MS) {
        throw new Error(`burst delay must be at least ${BOT_BURST_MIN_DELAY_MS}ms`);
    }
    return Math.round(delayMs);
}

const BURST_OPENERS = Object.freeze([
    'checking in from the bot side',
    'sending another quick note',
    'dropping a chat test message',
    'pushing one more message through',
    'keeping the thread warm',
    'making sure the list keeps up',
    'sending this for the smoke run',
    'adding another message to the stack',
]);

const BURST_DETAILS = Object.freeze([
    'the route should stay responsive',
    'the latest preview should update cleanly',
    'the keyboard should not get in the way',
    'the chat list should keep ordering stable',
    'the message row should render without drama',
    'the app can treat this like normal traffic',
    'the notification path should have something to chew on',
    'the cache should not need anything special here',
]);

const BURST_ENDINGS = Object.freeze([
    'nothing fancy, just pressure',
    'same test, different sentence',
    'this is still deterministic',
    'leaving enough delay to watch it land',
    'one more ordinary line',
    'almost like a real conversation',
    'good enough for a repeatable run',
    'keeping it plain text only',
]);

function pickBurstLine(parts, seed) {
    return parts[Math.abs(seed) % parts.length];
}

function makeBurstText(action, session, index, count) {
    const seed = `${action?.id || ''}:${session?.uid || ''}:${index}`
        .split('')
        .reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const opener = pickBurstLine(BURST_OPENERS, seed);
    const detail = pickBurstLine(BURST_DETAILS, seed + index + 3);
    const ending = pickBurstLine(BURST_ENDINGS, seed + index * 7 + 11);
    return `${opener}. ${detail}; ${ending}. ${index + 1}/${count}`;
}

async function isBlocked(uid, peerUid) {
    if (!uid || !peerUid) {
        return false;
    }
    const snap = await db.collection('users').doc(uid).collection('blocked').doc(peerUid).get();
    return snap.exists;
}

async function isChatBanned(uid) {
    if (!uid) {
        return false;
    }
    const snap = await db.collection('moderation').doc(uid).get();
    const banned = snap.data()?.banned;
    const activeBan = banned?.full || banned?.chat;
    if (!activeBan || typeof activeBan !== 'object') {
        return false;
    }
    if (activeBan.until == null) {
        return true;
    }
    return tsMs(activeBan.until) > Date.now();
}

async function getProfile(uid) {
    if (!uid) {
        return null;
    }
    const snap = await db.collection('profiles').doc(uid).get();
    if (!snap.exists) {
        return null;
    }
    const data = snap.data();
    return {
        uid: snap.id,
        ...data,
        walletPK: resolveWalletPK(data, SPARK_NETWORK),
    };
}

export class BotRuntime {
    constructor() {
        this.secretClient = createSecretClient();
        this.sessions = new Map();
        this.botJobs = new Map();
        this.actionJobs = new Map();
        this.chatPeers = new Map();
        this.running = false;
        this.stopped = false;
        this.bucket = admin.storage().bucket();
        this.walletDown = new Set();
        this.unsubscribeBots = null;
        this.unsubscribeActions = null;
        this.stopResolve = null;
        this.runtimeId = randomUUID();
        this.heartbeatTimer = null;
    }

    async start() {
        if (this.running) {
            return;
        }

        this.running = true;
        this.stopped = false;
        await this.acquireRuntimeLease();
        this.startHeartbeat();
        console.log(`bot runtime started on ${SPARK_NETWORK}`);
        this.subscribeBots();
        this.subscribeActions();

        await new Promise((resolve) => {
            this.stopResolve = resolve;
        });
    }

    async stop() {
        this.stopped = true;
        if (!this.running) {
            return;
        }

        this.running = false;

        if (this.unsubscribeBots) {
            try {
                this.unsubscribeBots();
            } catch {}
            this.unsubscribeBots = null;
        }

        if (this.unsubscribeActions) {
            try {
                this.unsubscribeActions();
            } catch {}
            this.unsubscribeActions = null;
        }

        const actionJobs = [...this.actionJobs.values()];
        if (actionJobs.length) {
            await Promise.allSettled(actionJobs);
        }

        const uids = [...this.sessions.keys()];
        for (const uid of uids) {
            await this.closeSession(uid);
        }

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        await this.releaseRuntimeLease();

        if (this.stopResolve) {
            this.stopResolve();
            this.stopResolve = null;
        }
    }

    subscribeBots() {
        const q = db.collection('bots').where('enabled', '==', true);

        this.unsubscribeBots = q.onSnapshot(
            (snap) => {
                void this.handleBotsSnapshot(snap).catch((error) => {
                    console.error('bot snapshot failed', error);
                });
            },
            (error) => {
                console.error('bot runtime subscription failed', error);
            }
        );
    }

    subscribeActions() {
        const q = runtimeRef().collection(BOT_RUNTIME_ACTIONS).where('status', '==', BOT_ACTION_STATUS_QUEUED);

        this.unsubscribeActions = q.onSnapshot(
            (snap) => {
                for (const change of snap.docChanges()) {
                    if (change.type === 'removed') {
                        continue;
                    }
                    void queueMapJob(this.actionJobs, 'actions', () => this.processAction(change.doc.ref)).catch((error) => {
                        console.error(`bot action ${change.doc.id} failed`, error);
                    });
                }
            },
            (error) => {
                console.error('bot runtime action subscription failed', error);
            }
        );
    }

    async acquireRuntimeLease() {
        const ref = runtimeRef();
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const data = snap.exists ? snap.data() : {};
            const heartbeatMs = tsMs(data?.heartbeatAt);
            const active = data?.running === true && heartbeatMs > Date.now() - BOT_RUNTIME_LEASE_MS;
            if (active && data?.runtimeId !== this.runtimeId) {
                throw new Error(`bot runtime already running (${data?.host || 'unknown host'} pid ${data?.pid || 'unknown'})`);
            }

            tx.set(
                ref,
                {
                    running: true,
                    runtimeId: this.runtimeId,
                    pid: process.pid,
                    host: hostname(),
                    startedAt: FieldValue.serverTimestamp(),
                    heartbeatAt: FieldValue.serverTimestamp(),
                    network: SPARK_NETWORK,
                    actions: RUNTIME_ACTIONS_SUPPORTED,
                },
                { merge: true }
            );
        });
    }

    startHeartbeat() {
        if (this.heartbeatTimer) {
            return;
        }
        this.heartbeatTimer = setInterval(() => {
            void db
                .collection('runtimes')
                .doc(BOT_RUNTIME_DOC_ID)
                .set(
                    {
                        running: true,
                        runtimeId: this.runtimeId,
                        pid: process.pid,
                        host: hostname(),
                        heartbeatAt: FieldValue.serverTimestamp(),
                        network: SPARK_NETWORK,
                        actions: RUNTIME_ACTIONS_SUPPORTED,
                    },
                    { merge: true }
                )
                .catch((error) => {
                    logHeartbeatError(error);
                });
        }, RUNTIME_HEARTBEAT_MS);
        this.heartbeatTimer.unref?.();
    }

    async releaseRuntimeLease() {
        const ref = runtimeRef();
        await db
            .runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                if (snap.exists && snap.data()?.runtimeId === this.runtimeId) {
                    tx.set(
                        ref,
                        {
                            running: false,
                            stoppedAt: FieldValue.serverTimestamp(),
                            heartbeatAt: FieldValue.serverTimestamp(),
                        },
                        { merge: true }
                    );
                }
            })
            .catch((error) => {
                console.error('bot runtime lease release failed', error);
            });
    }

    async processAction(actionRef) {
        const action = await this.claimAction(actionRef);
        if (!action) {
            return;
        }

        try {
            let result;
            if (action.type === BOT_ACTION_TYPE_BURST) {
                result = await this.runBurstAction(action);
            } else {
                throw new Error(`unsupported bot action: ${action.type || 'unknown'}`);
            }

            await actionRef.set(
                {
                    status: BOT_ACTION_STATUS_DONE,
                    result: result || null,
                    finishedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
            );
        } catch (error) {
            await actionRef.set(
                {
                    status: BOT_ACTION_STATUS_ERROR,
                    error: statusMessage(error),
                    finishedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
            );
            console.error(`bot action ${action.id} failed`, error);
        }
    }

    async claimAction(actionRef) {
        let action = null;
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(actionRef);
            if (!snap.exists) {
                return;
            }

            const data = snap.data();
            if (data?.status !== BOT_ACTION_STATUS_QUEUED) {
                return;
            }

            tx.set(
                actionRef,
                {
                    status: BOT_ACTION_STATUS_RUNNING,
                    runtimeId: this.runtimeId,
                    host: hostname(),
                    pid: process.pid,
                    startedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
            );
            action = {
                id: snap.id,
                ref: actionRef,
                ...data,
            };
        });
        return action;
    }

    activeBurstSessions() {
        return [...this.sessions.values()].filter((session) => (
            session?.started &&
            !session.closing &&
            (!session.mode || session.mode === BOT_MODE) &&
            session.chatJobs &&
            session.chatPK &&
            session.chatPrivKey
        ));
    }

    async waitForBurstSessions() {
        const deadline = Date.now() + BOT_BURST_SESSION_WAIT_MS;
        while (!this.stopped && Date.now() <= deadline) {
            const sessions = this.activeBurstSessions();
            if (sessions.length) {
                return sessions;
            }
            await sleep(250);
        }
        throw new Error('no active bot sessions');
    }

    async runBurstAction(action) {
        const count = cleanBurstCount(action.count);
        const delayMs = cleanBurstDelayMs(action.delayMs);
        const target = await getProfile(action.targetUid);
        if (!target?.uid || !target?.chatPK) {
            throw new Error('burst target missing chat identity');
        }
        if (target.bot) {
            throw new Error('burst target cannot be a bot');
        }

        await this.waitForBurstSessions();

        const usedBots = new Map();
        const sentChats = new Map();
        let sent = 0;

        for (let index = 0; index < count; index++) {
            if (this.stopped) {
                throw new Error('bot runtime stopped');
            }

            const sessions = this.activeBurstSessions();
            if (!sessions.length) {
                throw new Error('no active bot sessions');
            }

            const session = sessions[index % sessions.length];
            const chatId = getChatId(session.chatPK, target.chatPK);
            const message = makeTxt(makeBurstText(action, session, index, count));

            await queueMapJob(session.chatJobs, chatId, async () => {
                if (session.closing || this.stopped) {
                    throw new Error('bot session closed');
                }
                const result = await this.sendPayload(session, target.chatPK, message);
                sentChats.set(session.uid, result?.chatId || chatId);
            });

            usedBots.set(session.uid, session.username);
            sent++;

            if (index + 1 < count) {
                await sleep(delayMs);
            }
        }

        const readReceipts = await this.sendBurstReadReceipts(action, target, sentChats);

        return {
            type: BOT_ACTION_TYPE_BURST,
            requested: count,
            sent,
            delayMs,
            targetUid: target.uid,
            targetUsername: target.username || null,
            bots: [...usedBots.values()].filter(Boolean),
            readReceipts,
        };
    }

    async sendBurstReadReceipts(action, target, sentChats) {
        let sent = 0;
        for (const [uid, chatId] of sentChats.entries()) {
            if (this.stopped) {
                return sent;
            }

            const session = this.sessions.get(uid);
            if (!session || session.closing) {
                continue;
            }

            const receipt = await this.findLatestPeerReceiptTarget(chatId, target.chatPK);
            if (!receipt) {
                continue;
            }

            const result = await queueMapJob(session.chatJobs, chatId, () => {
                if (session.closing || this.stopped) {
                    throw new Error('bot session closed');
                }
                return this.sendReadReceipt(
                    session,
                    target.chatPK,
                    receipt.target,
                    null,
                    {
                        chatId,
                        msgId: `${action.id}_${receipt.msgId}`,
                        msgTs: receipt.ts,
                        peerChatPK: target.chatPK,
                    }
                );
            });
            if (!result?.skipped) {
                sent++;
            }
        }
        return sent;
    }

    async findLatestPeerReceiptTarget(chatId, peerChatPK) {
        const snap = await db.collection('chats').doc(chatId).collection('messages').orderBy('ts', 'desc').limit(BURST_READ_RECEIPT_SCAN_LIMIT).get();
        for (const msgSnap of snap.docs) {
            const data = msgSnap.data();
            if (data?.head?.from !== peerChatPK) {
                continue;
            }
            return {
                msgId: msgSnap.id,
                target: data?.head?.cid || msgSnap.id,
                ts: data?.ts,
            };
        }
        return null;
    }

    async handleBotsSnapshot(snap) {
        const bots = snap.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
                uid: docSnap.id,
                ref: docSnap.ref,
                ...data,
                walletPK: resolveWalletPK(data, SPARK_NETWORK),
            };
        });
        const activeUids = new Set(bots.map((bot) => bot.uid));

        for (const uid of [...this.sessions.keys()]) {
            if (activeUids.has(uid)) {
                continue;
            }

            void queueMapJob(this.botJobs, uid, () => this.closeSession(uid)).catch((error) => {
                console.error(`bot ${uid} shutdown failed`, error);
            });
        }

        for (const bot of bots) {
            void queueMapJob(this.botJobs, bot.uid, () => this.runBot(bot)).catch((error) => {
                console.error(`bot @${bot.username} sync failed`, error);
            });
        }
    }

    async runBot(bot) {
        const sessionKey = [bot.uid, bot.chatPK, bot.walletPK].join(':');
        const current = this.sessions.get(bot.uid);

        if (current?.key === sessionKey) {
            current.ref = bot.ref;
            current.username = bot.username;
            current.resumeAtMs = tsMs(bot.resumeAt);
            current.mode = bot.mode || BOT_MODE;
            return;
        }

        try {
            const session = await this.getSession(bot);
            await this.startSession(bot, session);
        } catch (error) {
            const isKeyMismatch = /key mismatch/i.test(statusMessage(error));
            await bot.ref.set(
                {
                    status: 'error',
                    lastError: statusMessage(error),
                    lastRunAt: FieldValue.serverTimestamp(),
                    ...(isKeyMismatch ? { enabled: false } : {}),
                },
                { merge: true }
            );
            if (isKeyMismatch) {
                console.error(`bot @${bot.username} disabled (key mismatch — re-provision on ${SPARK_NETWORK})`);
            } else {
                console.error(`bot @${bot.username} failed`, error);
            }
            await this.closeSession(bot.uid);
        }
    }

    async startSession(bot, session) {
        session.ref = bot.ref;
        session.username = bot.username;
        session.resumeAtMs = tsMs(bot.resumeAt);
        session.mode = bot.mode || BOT_MODE;

        if (session.started) {
            return;
        }

        session.started = true;
        session.chatJobs = new Map();
        session.chatRead = new Map();

        this.attachWalletListeners(session);
        session.unsubscribeChats = this.subscribeChats(session);

        const balance = await this.refreshBalance(session);
        console.log(`bot @${session.username} ready | balance: ${balance} sats`);
        await Promise.all([
            this.touchBot(session.ref, {
                status: 'running',
                lastError: null,
                ...(balance != null ? { balance: String(balance) } : {}),
            }),
            db.collection('profiles').doc(session.uid).set({ active: true }, { merge: true }),
        ]);
    }

    subscribeChats(session) {
        return db
            .collection('chats')
            .where('participants', 'array-contains', session.chatPK)
            .onSnapshot(
                (snap) => {
                    for (const change of snap.docChanges()) {
                        if (change.type === 'removed') {
                            session.chatRead?.delete(change.doc.id);
                            continue;
                        }

                        const chat = {
                            id: change.doc.id,
                            ref: change.doc.ref,
                            ...change.doc.data(),
                        };

                        void queueMapJob(session.chatJobs, chat.id, () => this.processChat(session, chat)).catch((error) => {
                            console.error(`bot @${session.username} chat ${chat.id} failed`, error);
                        });
                    }
                },
                (error) => {
                    console.error(`bot @${session.username} chat subscription failed`, error);
                    void this.touchBot(session.ref, {
                        status: 'error',
                        lastError: statusMessage(error),
                    });
                }
            );
    }

    attachWalletListeners(session) {
        if (!session?.wallet || session.walletListeners) {
            return;
        }

        const onBalanceUpdate = () => {
            void queueMapJob(session.chatJobs, '__wallet__', async () => {
                const balance = await this.refreshBalance(session);
                await this.touchBot(session.ref, {
                    status: 'running',
                    lastError: null,
                    ...(balance != null ? { balance: String(balance) } : {}),
                });
            }).catch((error) => {
                console.error(`bot @${session.username} balance update failed`, error);
            });
        };

        const onDisconnect = () => {
            this.markWalletDown(session.uid);
        };

        const onReconnect = () => {
            this.markWalletUp(session.uid);
        };

        session.wallet.on?.(SparkWalletEvent.TransferClaimed, onBalanceUpdate);
        session.wallet.on?.(SparkWalletEvent.BalanceUpdate, onBalanceUpdate);
        session.wallet.on?.(SparkWalletEvent.StreamReconnecting, onDisconnect);
        session.wallet.on?.(SparkWalletEvent.StreamDisconnected, onDisconnect);
        session.wallet.on?.(SparkWalletEvent.StreamConnected, onReconnect);

        session.walletListeners = { onBalanceUpdate, onDisconnect, onReconnect };
    }

    markWalletDown(uid) {
        if (!uid || this.walletDown.has(uid)) {
            return;
        }
        this.walletDown.add(uid);
        if (this.walletDown.size === 1) {
            verboseLog('wallet disconnected');
        }
    }

    markWalletUp(uid) {
        if (!uid || !this.walletDown.has(uid)) {
            return;
        }
        this.walletDown.delete(uid);
        if (this.walletDown.size === 0) {
            verboseLog('wallet reconnected');
        }
    }

    async touchBot(ref, data = {}) {
        if (!ref) {
            return;
        }
        await ref.set({ lastRunAt: FieldValue.serverTimestamp(), ...data }, { merge: true });
    }

    async refreshBalance(session) {
        const balance = await getBotBalance(session.wallet, { fallback: session.balance ?? null }).catch(() => session.balance ?? null);
        if (balance != null) {
            session.balance = balance;
        }
        return balance;
    }

    readRef(session, chatId) {
        return session.ref.collection(BOT_READS).doc(chatId);
    }

    async readChatMs(session, chatId) {
        if (session.chatRead?.has(chatId)) {
            return tsMs(session.chatRead.get(chatId));
        }
        let snap;
        try {
            snap = await this.readRef(session, chatId).get();
        } catch {
            return 0;
        }
        const readMs = tsMs(snap?.data()?.readAt);
        setLimitedMap(session.chatRead, chatId, readMs, MAX_BOT_READ_CACHE);
        return readMs;
    }

    async ackChat(session, chatId, readMs) {
        if (!chatId || !Number.isFinite(readMs) || readMs <= 0) {
            return;
        }
        if (tsMs(session.chatRead?.get(chatId)) >= readMs) {
            return;
        }
        await this.readRef(session, chatId).set(
            {
                readAt: Timestamp.fromMillis(readMs),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
        setLimitedMap(session.chatRead, chatId, readMs, MAX_BOT_READ_CACHE);
    }

    async getSession(bot) {
        if (!bot.walletPK || !bot.chatPK) {
            throw new Error(`bot @${bot.username} missing keys on bots doc`);
        }

        const current = this.sessions.get(bot.uid);
        const sessionKey = [bot.uid, bot.chatPK, bot.walletPK].join(':');
        if (current?.key === sessionKey) {
            current.ref = bot.ref;
            current.username = bot.username;
            current.resumeAtMs = tsMs(bot.resumeAt);
            current.mode = bot.mode || BOT_MODE;
            return current;
        }

        await this.closeSession(bot.uid);

        const masterSeed = await readBotSeed(this.secretClient, projectId, bot.username);
        try {
            const account = await bootBotAccount(masterSeed, {
                SparkWallet,
                network: SPARK_NETWORK,
            });

            if (!sameKey(account.walletPK, bot.walletPK) || !sameKey(account.chatPK, bot.chatPK)) {
                closeBotAccount(account);
                throw new Error(`bot @${bot.username} key mismatch`);
            }

            const session = {
                ...account,
                uid: bot.uid,
                username: bot.username,
                key: sessionKey,
                ref: bot.ref,
                resumeAtMs: tsMs(bot.resumeAt),
                mode: bot.mode || BOT_MODE,
                started: false,
                closing: false,
                balance: null,
                unsubscribeChats: null,
                walletListeners: null,
                chatJobs: new Map(),
                chatRead: new Map(),
            };

            this.sessions.set(bot.uid, session);
            await bot.ref.set(
                {
                    status: 'running',
                    lastBootAt: FieldValue.serverTimestamp(),
                    lastError: null,
                },
                { merge: true }
            );

            return session;
        } finally {
            masterSeed.fill(0);
        }
    }

    async closeSession(uid) {
        const session = this.sessions.get(uid);
        if (!session) {
            return;
        }

        session.closing = true;

        if (session.unsubscribeChats) {
            try {
                session.unsubscribeChats();
            } catch {}
            session.unsubscribeChats = null;
        }

        if (session.walletListeners) {
            const { onBalanceUpdate, onDisconnect, onReconnect } = session.walletListeners;
            session.wallet.off?.(SparkWalletEvent.TransferClaimed, onBalanceUpdate);
            session.wallet.off?.(SparkWalletEvent.BalanceUpdate, onBalanceUpdate);
            session.wallet.off?.(SparkWalletEvent.StreamReconnecting, onDisconnect);
            session.wallet.off?.(SparkWalletEvent.StreamDisconnected, onDisconnect);
            session.wallet.off?.(SparkWalletEvent.StreamConnected, onReconnect);
            session.walletListeners = null;
        }

        this.walletDown.delete(uid);

        const jobs = session.chatJobs ? [...session.chatJobs.values()] : [];
        if (jobs.length) {
            await Promise.allSettled(jobs);
        }

        await db.collection('profiles').doc(uid).set({ active: false }, { merge: true }).catch(() => {});

        this.sessions.delete(uid);
        closeBotAccount(session);

        if (this.sessions.size === 0) {
            clearBotChatPairCache();
            this.chatPeers.clear();
        }
    }

    async resolvePeerByChatPK(chatPK) {
        const key = String(chatPK ?? '')
            .trim()
            .toLowerCase();
        if (!key) {
            return null;
        }
        if (this.chatPeers.has(key)) {
            return this.chatPeers.get(key);
        }

        const profileSnap = await db.collection('profiles').where('chatPK', '==', key).limit(2).get();
        const peer = profileSnap.docs.length === 1 ? { uid: profileSnap.docs[0].id, ...profileSnap.docs[0].data() } : null;
        setLimitedMap(this.chatPeers, key, peer, MAX_BOT_PEER_CACHE);
        return peer;
    }

    async processChat(session, chat) {
        if (session.closing || (session.mode && session.mode !== BOT_MODE)) {
            return;
        }

        const participants = Array.isArray(chat?.participants) ? chat.participants.filter(Boolean) : [];
        const peerChatPK = participants.find((participant) => participant !== session.chatPK);
        if (!peerChatPK) {
            return;
        }

        const chatRecencyMs = tsMs(chat?.ts);
        if (!chatRecencyMs) {
            return;
        }

        const sinceMs = Math.max(session.resumeAtMs, await this.readChatMs(session, chat.id));
        if (chatRecencyMs <= sinceMs) {
            return;
        }

        let msgsSnap = await chat.ref.collection('messages').where('ts', '>', Timestamp.fromMillis(sinceMs)).orderBy('ts', 'asc').get();
        if (msgsSnap.empty && chatRecencyMs > sinceMs) {
            // A brand-new chat can surface in the parent collection just before its
            // first message becomes readable via the subcollection query.
            await sleep(250);
            msgsSnap = await chat.ref.collection('messages').where('ts', '>', Timestamp.fromMillis(sinceMs)).orderBy('ts', 'asc').get();
        }
        if (msgsSnap.empty) {
            return;
        }

        const latestMs = tsMs(msgsSnap.docs[msgsSnap.docs.length - 1]?.data()?.ts);
        const hasPeerDocs = msgsSnap.docs.some((msgSnap) => msgSnap.data()?.head?.from === peerChatPK);
        if (!hasPeerDocs) {
            await this.ackChat(session, chat.id, latestMs);
            return;
        }

        const settings = await decryptBotChatSettings(chat?.settings, session.chatPK, session.chatPrivKey, peerChatPK);
        if (!settings) {
            return;
        }
        const retention = settings.retention;
        let readMs = sinceMs;
        const replies = [];
        let receipt = null;

        for (const msgSnap of msgsSnap.docs) {
            if (session.closing) {
                return;
            }

            const msgData = msgSnap.data();
            const senderChatPK = typeof msgData?.head?.from === 'string' ? msgData.head.from : '';
            const msgMs = tsMs(msgData?.ts);

            if (senderChatPK !== peerChatPK) {
                readMs = Math.max(readMs, msgMs);
                continue;
            }

            const context = {
                chatId: chat.id,
                msgId: msgSnap.id,
                msgTs: msgData?.ts,
                peerChatPK,
                retention,
            };
            const msg = await this.readChatMessage(
                session,
                context,
                msgData
            );
            if (msg) {
                replies.push({ context, msg });
                receipt = {
                    context,
                    target: msgData?.head?.cid || msgSnap.id,
                };
            }

            readMs = Math.max(readMs, msgMs);
        }

        if (!replies.length) {
            await this.ackChat(session, chat.id, readMs);
            return;
        }

        const peer = await this.resolvePeerByChatPK(peerChatPK);
        if (!peer?.uid) {
            return;
        }

        const [peerBanned, botBlockedPeer, peerBlockedBot, botBanned] = await Promise.all([
            isChatBanned(peer.uid),
            isBlocked(session.uid, peer.uid),
            isBlocked(peer.uid, session.uid),
            isChatBanned(session.uid),
        ]);

        if (peer?.bot || peerBanned || botBlockedPeer || peerBlockedBot || botBanned) {
            await this.ackChat(session, chat.id, latestMs);
            return;
        }

        if (receipt) {
            await this.sendReadReceipt(session, peerChatPK, receipt.target, retention, receipt.context).catch((error) => {
                console.warn('bot read receipt failed', chat.id, statusMessage(error));
            });
            await this.sendHiddenCheckpoint(session, peerChatPK, receipt.target, retention, receipt.context).catch((error) => {
                console.warn('bot hidden checkpoint failed', chat.id, statusMessage(error));
            });
        }

        if (BOT_REPLY_AFTER_READ_DELAY_MS > 0) {
            await sleep(BOT_REPLY_AFTER_READ_DELAY_MS);
        }

        const peerWalletPK = resolveWalletPK(peer, SPARK_NETWORK);
        for (const item of replies) {
            if (session.closing) {
                return;
            }
            await this.replyToChatMessage(session, {
                ...item.context,
                peerUid: peer.uid,
                peerWalletPK,
            }, item.msg);
        }

        await this.ackChat(session, chat.id, readMs);
    }

    async readChatMessage(session, context, msgData) {
        const msg = await decryptBotMsg(msgData, session.chatPK, session.chatPrivKey, context.peerChatPK);
        if (!msg) {
            return null;
        }

        if (isControlMsg(msg) || isSystemMsg(msg)) {
            return null;
        }

        return msg;
    }

    async replyToChatMessage(session, context, msg) {
        if (msg.t === 'req') {
            await this.handleRequest(session, context, msg);
            return;
        }

        if (hasAttachment(msg)) {
            const msgId = botReplyId(context, 'file');
            if (await hasBotMsg(db, context.chatId, msgId)) {
                return;
            }
            const body = await readBotMsgAttachment(this.bucket, session.chatPK, session.chatPrivKey, context.peerChatPK, msg);
            await uploadBotAttachmentMsg(db, FieldValue, this.bucket, session.chatPK, session.chatPrivKey, context.peerChatPK, {
                cid: botReplyCid(context, 'file'),
                type: msg.t,
                data: body,
                meta: attachmentMeta(msg),
            }, { msgId, retention: context.retention });
            return;
        }

        await this.sendPayload(session, context.peerChatPK, cleanPayload(msg), {
            cid: botReplyCid(context, 'reply'),
            msgId: botReplyId(context, 'reply'),
            retention: context.retention,
        });
    }

    async handleRequest(session, context, msg) {
        const amount = String(msg?.a ?? '').trim();
        if (!amount) {
            throw new Error('request amount missing');
        }
        if (msg?.tx) {
            return;
        }
        if (await hasBotMsg(db, context.chatId, botReplyId(context, 'req'))) {
            return;
        }

        const peerWalletPK = context.peerWalletPK || resolveWalletPK(await getProfile(context.peerUid), SPARK_NETWORK) || '';
        if (!peerWalletPK) {
            throw new Error('peer wallet missing');
        }

        const balance = await this.refreshBalance(session);
        const amountSats = Number.parseInt(amount, 10);
        if (!Number.isFinite(amountSats) || amountSats <= 0) {
            throw new Error('invalid request amount');
        }

        if (!Number.isFinite(balance) || balance < amountSats) {
            await this.sendPayload(session, context.peerChatPK, makeTxt(BOT_UNDERFUNDED_TEXT), {
                cid: botReplyCid(context, 'funds'),
                msgId: botReplyId(context, 'funds'),
                retention: context.retention,
            });
            return;
        }

        const txId = await mirrorBotTransfer(session.wallet, peerWalletPK, amountSats, SPARK_NETWORK);
        const patched = { ...setReqTx(msg, txId), cid: msg.cid };

        try {
            await updateBotMsg(db, context.chatId, context.msgId, session.chatPrivKey, context.peerChatPK, patched);
        } catch (error) {
            console.warn('bot request patch failed', context.chatId, statusMessage(error));
        }

        await this.sendPayload(session, context.peerChatPK, makeReq(amount), {
            cid: botReplyCid(context, 'req'),
            msgId: botReplyId(context, 'req'),
            retention: context.retention,
        });

        const nextBalance = await this.refreshBalance(session);
        await this.touchBot(session.ref, {
            status: 'running',
            lastError: null,
            ...(nextBalance != null ? { balance: String(nextBalance) } : {}),
        });
    }

    async sendPayload(session, peerChatPK, payload, options = {}) {
        return sendBotMsg(db, FieldValue, session.chatPK, session.chatPrivKey, peerChatPK, {
            ...payload,
            cid: options.cid || makeCid(),
        }, { ...(options.msgId ? { msgId: options.msgId } : {}), retention: options.retention });
    }

    async sendReadReceipt(session, peerChatPK, target, retention, context = {}) {
        const msgId = botReplyId(context, 'rr');
        return sendBotMsg(
            db,
            FieldValue,
            session.chatPK,
            session.chatPrivKey,
            peerChatPK,
            {
                ...makeReadReceipt(target),
                cid: makeCid(),
                s: session.chatPK,
            },
            { updateLastMsg: false, retention, ...(msgId ? { msgId } : {}) }
        );
    }

    async sendHiddenCheckpoint(session, peerChatPK, target, retention, context = {}) {
        const msgId = botReplyId(context, 'hid');
        return sendBotMsg(
            db,
            FieldValue,
            session.chatPK,
            session.chatPrivKey,
            peerChatPK,
            {
                ...makeHiddenCheckpoint(target),
                cid: makeCid(),
                s: session.chatPK,
            },
            { updateLastMsg: false, retention, ...(msgId ? { msgId } : {}) }
        );
    }
}
