import {
    BOT_ACTION_STATUS_DONE,
    BOT_ACTION_STATUS_ERROR,
    BOT_ACTION_STATUS_CANCELLED,
    BOT_ACTION_STATUS_QUEUED,
    BOT_ACTION_STATUS_RUNNING,
    BOT_ACTION_TYPE_BURST,
    BOT_ACTION_TYPE_FUND_BOTS,
    BOT_ACTION_TYPE_TRANSFER_BURST,
    BOT_MODE,
    BOT_RUNTIME_ACTIONS,
    BOT_RUNTIME_DOC_ID,
    BOT_RUNTIME_LEASE_MS,
    BOT_UNDERFUNDED_TEXT,
} from '@veyl/shared/bot/events';
import { bootBotAccount, closeBotAccount } from '@veyl/shared/bot/account';
import {
    BOT_BURST_REQUEST_AMOUNT_BUCKETS,
    BOT_BURST_EXCLUDED_USERNAMES,
    BOT_BURST_REQUEST_WEIGHT,
    BOT_BURST_TEXT_WEIGHT,
    cleanBurstCount,
    cleanBurstDelayMs,
} from '@veyl/shared/bot/burst';
import { BOT_BURST_MESSAGES } from '@veyl/shared/bot/burstmessages';
import { clearBotChatPairCache, decryptBotChatSettings, decryptBotMsg, hasBotMsg, readBotMsgAttachment, sendBotMsg, updateBotMsg, uploadBotAttachmentMsg } from '@veyl/shared/bot/chat';
import { getBotBalance, mirrorBotTransfer } from '@veyl/shared/bot/wallet';
import { getChatPeerPK } from '@veyl/shared/chat/ids';
import { hasStoredFileRef, isControlMsg, isSystemMsg, makeHiddenCheckpoint, makeReadReceipt, makeReq, makeTxt, setReqTx } from '@veyl/shared/chat/messages';
import { getMessageKey, makeCid } from '@veyl/shared/chat/state';
import { getChatId } from '@veyl/shared/crypto/chat';
import {
    BOT_BURST_SESSION_WAIT_MS,
    BOT_REPLY_AFTER_READ_DELAY_MS,
} from '@veyl/shared/config';
import { banState } from '@veyl/shared/moderation';
import { resolveNetwork } from '@veyl/shared/network';
import { lowerText, sameText } from '@veyl/shared/utils/text';
import { timestampMs } from '@veyl/shared/utils/time';
import { resolveWalletPK } from '@veyl/shared/wallet/keys';
import { sleep } from '@veyl/shared/utils/async';
import { SparkWallet, SparkWalletEvent } from '@buildonspark/spark-sdk';
import { randomInt, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import admin, { db, FieldValue, Timestamp, projectId } from './admin.js';
import { createSecretClient, readBotSeed } from './secrets.js';

const SPARK_NETWORK = resolveNetwork(process.env);
const VERBOSE = process.env.VEYL_VERBOSE === '1';
const MAX_BOT_PEER_CACHE = 512;
const MAX_BOT_READ_CACHE = 2048;
const REVIEW_BOT_USERNAME = 'review';
const DEFAULT_TRANSFER_BURST_AMOUNT_SATS = 1;
const DEFAULT_FUND_BOT_AMOUNT_SATS = 1000;
const TRANSFER_BURST_CONCURRENCY = 8;
const BOT_READS = 'reads';
const RUNTIME_HEARTBEAT_MS = 15000;
const RUNTIME_ACTIONS_SUPPORTED = Object.freeze([BOT_ACTION_TYPE_BURST, BOT_ACTION_TYPE_FUND_BOTS, BOT_ACTION_TYPE_TRANSFER_BURST]);
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
    const ms = Math.max(1, timestampMs(context?.msgTs, 0));
    const base = ms.toString(36);
    const suffix = cleanDocPart(`${kind}${context?.msgId || ''}`)
        .padEnd(6, '0')
        .slice(0, 6);
    return `${base}${suffix}`;
}

function receiptTarget(msgSnap, data) {
    return getMessageKey({ ...(data?.head || {}), id: msgSnap?.id });
}

function verboseLog(...args) {
    if (VERBOSE) {
        console.log(...args);
    }
}

function attachmentFields(msg) {
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

function runtimeRef() {
    return db.collection('runtimes').doc(BOT_RUNTIME_DOC_ID);
}

const burstExcludedUsernames = new Set(BOT_BURST_EXCLUDED_USERNAMES.map(lowerText));

function pickRandom(items) {
    if (!items.length) {
        return null;
    }
    return items[randomInt(items.length)];
}

function pickWeighted(items) {
    const totalWeight = items.reduce((total, item) => total + Math.max(0, Number(item?.weight) || 0), 0);
    if (totalWeight <= 0) {
        return null;
    }

    let ticket = randomInt(totalWeight);
    for (const item of items) {
        ticket -= Math.max(0, Number(item?.weight) || 0);
        if (ticket < 0) {
            return item;
        }
    }

    return items[items.length - 1] || null;
}

function randomBurstRequestAmount() {
    const bucket = pickWeighted(BOT_BURST_REQUEST_AMOUNT_BUCKETS);
    if (!bucket) {
        throw new Error('burst request amount buckets are empty');
    }

    const min = Math.max(1, Math.floor(Number(bucket.min) || 0));
    const max = Math.max(min, Math.floor(Number(bucket.max) || min));
    const step = Math.max(1, Math.floor(Number(bucket.step) || 1));
    const steps = Math.floor((max - min) / step);
    return min + randomInt(steps + 1) * step;
}

function randomBurstPayload() {
    const totalWeight = BOT_BURST_TEXT_WEIGHT + BOT_BURST_REQUEST_WEIGHT;
    if (totalWeight > 0 && randomInt(totalWeight) < BOT_BURST_REQUEST_WEIGHT) {
        return { payload: makeReq(String(randomBurstRequestAmount())), request: true };
    }

    const text = pickRandom(BOT_BURST_MESSAGES);
    if (!text) {
        throw new Error('burst message pool is empty');
    }
    return { payload: makeTxt(text), request: false };
}

function cleanTransferAmount(value, fallback = DEFAULT_TRANSFER_BURST_AMOUNT_SATS) {
    const amount = Number(value ?? fallback);
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error('transfer amount must be a positive integer sat amount');
    }
    return amount;
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
    return banState(snap.data()?.banned).chatBanned;
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
        await this.cancelStaleRunningActions();
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
                    void queueMapJob(this.actionJobs, change.doc.id, () => this.processAction(change.doc.ref)).catch((error) => {
                        console.error(`bot action ${change.doc.id} failed`, error);
                    });
                }
            },
            (error) => {
                console.error('bot runtime action subscription failed', error);
            }
        );
    }

    async cancelStaleRunningActions() {
        const snap = await runtimeRef().collection(BOT_RUNTIME_ACTIONS).where('status', '==', BOT_ACTION_STATUS_RUNNING).get();
        if (snap.empty) {
            return;
        }

        const batch = db.batch();
        for (const docSnap of snap.docs) {
            batch.set(
                docSnap.ref,
                {
                    status: BOT_ACTION_STATUS_CANCELLED,
                    cancelReason: 'runtime restarted',
                    finishedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
            );
        }
        await batch.commit();
        console.warn(`cancelled ${snap.size} stale bot action${snap.size === 1 ? '' : 's'}`);
    }

    async acquireRuntimeLease() {
        const ref = runtimeRef();
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const data = snap.exists ? snap.data() : {};
            const heartbeatMs = timestampMs(data?.heartbeatAt, 0);
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
            } else if (action.type === BOT_ACTION_TYPE_FUND_BOTS) {
                result = await this.runFundBotsAction(action);
            } else if (action.type === BOT_ACTION_TYPE_TRANSFER_BURST) {
                result = await this.runTransferBurstAction(action);
            } else {
                throw new Error(`unsupported bot action: ${action.type || 'unknown'}`);
            }

            const status = result?.cancelled ? BOT_ACTION_STATUS_CANCELLED : BOT_ACTION_STATUS_DONE;
            await actionRef.set(
                {
                    status,
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

    async isActionCancelRequested(action) {
        const snap = await action.ref.get();
        const data = snap.exists ? snap.data() : {};
        return data?.cancelRequested === true || data?.status === BOT_ACTION_STATUS_CANCELLED;
    }

    activeBurstSessions() {
        return [...this.sessions.values()].filter((session) => (
            session?.started &&
            !session.closing &&
            (!session.mode || session.mode === BOT_MODE) &&
            session.chatJobs &&
            session.chatPK &&
            session.chatPrivKey &&
            !burstExcludedUsernames.has(lowerText(session.username))
        ));
    }

    reviewSession() {
        return [...this.sessions.values()].find((session) => (
            session?.started &&
            !session.closing &&
            session.wallet &&
            sameText(session.username, REVIEW_BOT_USERNAME)
        )) || null;
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

    async runFundBotsAction(action) {
        const amountSats = cleanTransferAmount(action.amountSats, DEFAULT_FUND_BOT_AMOUNT_SATS);
        await this.waitForBurstSessions();
        const review = this.reviewSession();
        if (!review) {
            throw new Error('review bot session is not active');
        }

        const funded = [];
        let cancelled = false;
        for (const session of this.activeBurstSessions()) {
            if (this.stopped || await this.isActionCancelRequested(action)) {
                cancelled = true;
                break;
            }
            if (!session.walletPK) {
                continue;
            }

            const txId = await queueMapJob(review.chatJobs, `fund:${session.uid}`, () => mirrorBotTransfer(review.wallet, session.walletPK, amountSats, SPARK_NETWORK));
            funded.push({ uid: session.uid, username: session.username || null, txId });
            verboseLog(`bot fund-bots ${funded.length}: @${session.username} ${amountSats} sats`);
            if (Number(action.delayMs) > 0) {
                await sleep(Number(action.delayMs));
            }
        }

        const balance = await this.refreshBalance(review);
        await this.touchBot(review.ref, {
            status: 'running',
            lastError: null,
            ...(balance != null ? { balance: String(balance) } : {}),
        });

        return {
            type: BOT_ACTION_TYPE_FUND_BOTS,
            amountSats,
            requested: this.activeBurstSessions().length,
            sent: funded.length,
            cancelled,
            bots: funded.map((entry) => entry.username).filter(Boolean),
        };
    }

    async runTransferBurstAction(action) {
        const count = cleanBurstCount(action.count);
        const delayMs = cleanBurstDelayMs(action.delayMs);
        const amountSats = cleanTransferAmount(action.amountSats, DEFAULT_TRANSFER_BURST_AMOUNT_SATS);
        const target = await getProfile(action.targetUid);
        const targetWalletPK = resolveWalletPK(target, SPARK_NETWORK);
        if (!target?.uid || !targetWalletPK) {
            throw new Error('transfer burst target missing wallet identity');
        }
        if (target.bot) {
            throw new Error('transfer burst target cannot be a bot');
        }

        await this.waitForBurstSessions();

        const usedBots = new Map();
        const inFlight = new Set();
        const errors = [];
        let sent = 0;
        let scheduled = 0;
        let cancelled = false;

        const waitForTransferSlot = async () => {
            while (inFlight.size >= TRANSFER_BURST_CONCURRENCY) {
                await Promise.race(inFlight);
            }
        };

        for (let index = 0; index < count; index++) {
            if (this.stopped || await this.isActionCancelRequested(action)) {
                cancelled = true;
                break;
            }

            await waitForTransferSlot();

            const sessions = this.activeBurstSessions().filter((session) => session.wallet);
            if (!sessions.length) {
                throw new Error('no active funded bot sessions');
            }

            const session = pickRandom(sessions);
            scheduled++;
            usedBots.set(session.uid, session.username);
            const transfer = queueMapJob(session.chatJobs, '__wallet_transfer_burst__', async () => {
                if (session.closing || this.stopped) {
                    throw new Error('bot session closed');
                }
                await mirrorBotTransfer(session.wallet, targetWalletPK, amountSats, SPARK_NETWORK);
                const balance = await this.refreshBalance(session);
                await this.touchBot(session.ref, {
                    status: 'running',
                    lastError: null,
                    ...(balance != null ? { balance: String(balance) } : {}),
                });
            })
                .then(() => {
                    sent++;
                    if (sent === 1 || sent === count || sent % 10 === 0) {
                        verboseLog(`bot transfer-burst ${sent}/${count}: ${amountSats} sats to @${target.username || target.uid}`);
                    }
                })
                .catch((error) => {
                    errors.push(statusMessage(error));
                    console.warn(`bot transfer-burst failed for @${session.username}`, error);
                })
                .finally(() => {
                    inFlight.delete(transfer);
                });
            inFlight.add(transfer);

            if (index + 1 < count) {
                await sleep(delayMs);
            }
        }

        if (inFlight.size) {
            await Promise.all(inFlight);
        }
        if (!sent && errors.length) {
            throw new Error(errors[0]);
        }

        return {
            type: BOT_ACTION_TYPE_TRANSFER_BURST,
            requested: count,
            sent,
            scheduled,
            cancelled,
            errors: errors.length,
            amountSats,
            delayMs,
            targetUid: target.uid,
            targetUsername: target.username || null,
            bots: [...usedBots.values()].filter(Boolean),
        };
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
        let requests = 0;
        let cancelled = false;

        for (let index = 0; index < count; index++) {
            if (this.stopped || await this.isActionCancelRequested(action)) {
                cancelled = true;
                break;
            }

            const sessions = this.activeBurstSessions();
            if (!sessions.length) {
                throw new Error('no active bot sessions');
            }

            const session = pickRandom(sessions);
            const message = randomBurstPayload();
            const chatId = getChatId(session.chatPK, target.chatPK);

            await queueMapJob(session.chatJobs, chatId, async () => {
                if (session.closing || this.stopped) {
                    throw new Error('bot session closed');
                }
                const result = await this.sendPayload(session, target.chatPK, message.payload);
                sentChats.set(session.uid, result?.chatId || chatId);
            });

            usedBots.set(session.uid, session.username);
            sent++;
            if (message.request) {
                requests++;
            }

            if (index + 1 < count) {
                await sleep(delayMs);
            }
        }

        const readReceipts = cancelled ? 0 : await this.sendBurstReadReceipts(action, target, sentChats);

        return {
            type: BOT_ACTION_TYPE_BURST,
            requested: count,
            sent,
            cancelled,
            delayMs,
            targetUid: target.uid,
            targetUsername: target.username || null,
            bots: [...usedBots.values()].filter(Boolean),
            requests,
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
                target: receiptTarget(msgSnap, data),
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
            current.resumeAtMs = timestampMs(bot.resumeAt, 0);
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
        session.resumeAtMs = timestampMs(bot.resumeAt, 0);
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
            return timestampMs(session.chatRead.get(chatId), 0);
        }
        let snap;
        try {
            snap = await this.readRef(session, chatId).get();
        } catch {
            return 0;
        }
        const readMs = timestampMs(snap?.data()?.readAt, 0);
        setLimitedMap(session.chatRead, chatId, readMs, MAX_BOT_READ_CACHE);
        return readMs;
    }

    async ackChat(session, chatId, readMs) {
        if (!chatId || !Number.isFinite(readMs) || readMs <= 0) {
            return;
        }
        if (timestampMs(session.chatRead?.get(chatId), 0) >= readMs) {
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
            current.resumeAtMs = timestampMs(bot.resumeAt, 0);
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

            if (!sameText(account.walletPK, bot.walletPK) || !sameText(account.chatPK, bot.chatPK)) {
                closeBotAccount(account);
                throw new Error(`bot @${bot.username} key mismatch`);
            }

            const session = {
                ...account,
                uid: bot.uid,
                username: bot.username,
                key: sessionKey,
                ref: bot.ref,
                resumeAtMs: timestampMs(bot.resumeAt, 0),
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
        const key = lowerText(chatPK);
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

        const peerChatPK = getChatPeerPK(chat, session.chatPK);
        if (!peerChatPK) {
            return;
        }

        const chatRecencyMs = timestampMs(chat?.ts, 0);
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

        const latestMs = timestampMs(msgsSnap.docs[msgsSnap.docs.length - 1]?.data()?.ts, 0);
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
            const msgMs = timestampMs(msgData?.ts, 0);

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
                    target: receiptTarget(msgSnap, msgData),
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

        if (hasStoredFileRef(msg)) {
            const msgId = botReplyId(context, 'file');
            if (await hasBotMsg(db, context.chatId, msgId)) {
                return;
            }
            const body = await readBotMsgAttachment(this.bucket, session.chatPK, session.chatPrivKey, context.peerChatPK, msg);
            await uploadBotAttachmentMsg(db, FieldValue, this.bucket, session.chatPK, session.chatPrivKey, context.peerChatPK, {
                cid: botReplyCid(context, 'file'),
                type: msg.t,
                data: body,
                meta: attachmentFields(msg),
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
