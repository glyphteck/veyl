import { BOT_MODE, BOT_UNDERFUNDED_TEXT } from '@glyphteck/shared/bot/events';
import { bootBotAccount, closeBotAccount } from '@glyphteck/shared/bot/account';
import { clearBotChatPairCache, decryptBotChatSettings, decryptBotMsg, readBotMsgAttachment, sendBotMsg, updateBotMsg, uploadBotAttachmentMsg } from '@glyphteck/shared/bot/chat';
import { getBotBalance, mirrorBotTransfer } from '@glyphteck/shared/bot/wallet';
import { isControlMsg, isSystemMsg, makeReadReceipt, makeReq, makeTxt, setReqTx } from '@glyphteck/shared/chat/messages';
import { makeCid } from '@glyphteck/shared/chat/state';
import { CHAT_RETENTION_24H, CHAT_RETENTION_SEEN, getMessageRetention, onSeenMessageTtlMs, seenMessageTtlMs, shouldShortenTtl } from '@glyphteck/shared/chat/ttl';
import { resolveNetwork } from '@glyphteck/shared/network';
import { resolveWalletPK } from '@glyphteck/shared/walletkeys';
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
const RUNTIME_LEASE_MS = 45000;
const RUNTIME_HEARTBEAT_MS = 15000;
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
        this.chatPeers = new Map();
        this.running = false;
        this.stopped = false;
        this.bucket = admin.storage().bucket();
        this.walletDown = new Set();
        this.unsubscribeBots = null;
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

    async acquireRuntimeLease() {
        const ref = db.collection('runtimes').doc('bot');
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const data = snap.exists ? snap.data() : {};
            const heartbeatMs = tsMs(data?.heartbeatAt);
            const active = data?.running === true && heartbeatMs > Date.now() - RUNTIME_LEASE_MS;
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
                .doc('bot')
                .set(
                    {
                        running: true,
                        runtimeId: this.runtimeId,
                        pid: process.pid,
                        host: hostname(),
                        heartbeatAt: FieldValue.serverTimestamp(),
                        network: SPARK_NETWORK,
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
        const ref = db.collection('runtimes').doc('bot');
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
        const snap = await this.readRef(session, chatId).get().catch(() => null);
        return tsMs(snap?.data()?.readAt);
    }

    async ackChat(session, chatId, readMs) {
        if (!chatId || !Number.isFinite(readMs) || readMs <= 0) {
            return;
        }
        setLimitedMap(session.chatRead, chatId, readMs, MAX_BOT_READ_CACHE);
        await this.readRef(session, chatId).set(
            {
                readAt: Timestamp.fromMillis(readMs),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
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

        const keySnap = await db.collection('chatkeys').doc(key).get();
        const uid = typeof keySnap.data()?.uid === 'string' ? keySnap.data().uid.trim() : '';
        const profileSnap = uid ? await db.collection('profiles').doc(uid).get() : null;
        const peer = uid ? { uid, ...(profileSnap?.exists ? profileSnap.data() : { chatPK: key }) } : null;
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
        const settings = await decryptBotChatSettings(chat?.settings, session.chatPK, session.chatPrivKey, peerChatPK);
        if (!settings) {
            return;
        }
        const retention = settings.retention;

        const chatRecencyMs = tsMs(chat?.ts);
        if (!chatRecencyMs) {
            return;
        }

        const localReadMs = tsMs(session.chatRead?.get(chat.id));
        const storedReadMs = await this.readChatMs(session, chat.id);
        const sinceMs = Math.max(session.resumeAtMs, localReadMs, storedReadMs);
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

        const peer = await this.resolvePeerByChatPK(peerChatPK);
        if (!peer?.uid) {
            return;
        }

        const latestMs = tsMs(msgsSnap.docs[msgsSnap.docs.length - 1]?.data()?.ts);
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

        let readMs = sinceMs;
        let receiptTarget = null;

        for (const msgSnap of msgsSnap.docs) {
            if (session.closing) {
                return;
            }

            const msgData = msgSnap.data();
            const senderChatPK = typeof msgData?.head?.from === 'string' ? msgData.head.from : '';
            const msgMs = tsMs(msgData?.ts);

            if (senderChatPK !== peerChatPK) {
                readMs = Math.max(readMs, msgMs);
                await this.ackChat(session, chat.id, readMs);
                continue;
            }

            const viewed = await this.handleChatMessage(
                session,
                {
                    chatId: chat.id,
                    msgId: msgSnap.id,
                    msgTs: msgData?.ts,
                    peerUid: peer.uid,
                    peerChatPK,
                    peerWalletPK: resolveWalletPK(peer, SPARK_NETWORK),
                    retention,
                },
                msgData
            );
            if (viewed?.seen) {
                const seenRetention = viewed.retention;
                receiptTarget = msgData?.head?.cid || msgSnap.id;
                if (seenRetention === CHAT_RETENTION_24H || seenRetention === CHAT_RETENTION_SEEN) {
                    const seenTtlMs = seenRetention === CHAT_RETENTION_SEEN ? onSeenMessageTtlMs() : seenMessageTtlMs();
                    if (shouldShortenTtl(msgData?.ttl, seenTtlMs)) {
                        const ttl = Timestamp.fromMillis(seenTtlMs);
                        await msgSnap.ref.update({ ttl }).catch(() => {});
                        if (chat?.lastMsg?.head?.cid && chat.lastMsg.head.cid === msgData?.head?.cid) {
                            await chat.ref.update({ lastMsg: { head: chat.lastMsg.head, body: chat.lastMsg.body, ttl } }).catch(() => {});
                        }
                    }
                }
            }

            readMs = Math.max(readMs, msgMs);
            await this.ackChat(session, chat.id, readMs);
        }

        if (receiptTarget) {
            await this.sendReadReceipt(session, peerChatPK, receiptTarget, retention).catch((error) => {
                console.warn('bot read receipt failed', chat.id, statusMessage(error));
            });
        }

        await this.ackChat(session, chat.id, readMs);
    }

    async handleChatMessage(session, context, msgData) {
        const msg = await decryptBotMsg(msgData, session.chatPK, session.chatPrivKey, context.peerChatPK);
        if (!msg) {
            return null;
        }

        if (isControlMsg(msg) || isSystemMsg(msg)) {
            return null;
        }

        const seen = { seen: true, retention: getMessageRetention(msg) };

        if (msg.t === 'req') {
            await this.handleRequest(session, context, msg);
            return seen;
        }

        if (hasAttachment(msg)) {
            const body = await readBotMsgAttachment(this.bucket, session.chatPK, session.chatPrivKey, context.peerChatPK, msg);
            await uploadBotAttachmentMsg(db, FieldValue, this.bucket, session.chatPK, session.chatPrivKey, context.peerChatPK, {
                cid: botReplyCid(context, 'file'),
                type: msg.t,
                data: body,
                meta: attachmentMeta(msg),
            }, { msgId: botReplyId(context, 'file'), retention: context.retention });
            return seen;
        }

        await this.sendPayload(session, context.peerChatPK, cleanPayload(msg), {
            cid: botReplyCid(context, 'reply'),
            msgId: botReplyId(context, 'reply'),
            retention: context.retention,
        });
        return seen;
    }

    async handleRequest(session, context, msg) {
        const amount = String(msg?.a ?? '').trim();
        if (!amount) {
            throw new Error('request amount missing');
        }
        if (msg?.tx) {
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

    async sendReadReceipt(session, peerChatPK, target, retention) {
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
            { updateLastMsg: false, retention }
        );
    }
}
