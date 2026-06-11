import {
    BOT_ACTION_STATUS_DONE,
    BOT_ACTION_STATUS_ERROR,
    BOT_ACTION_STATUS_CANCELLED,
    BOT_ACTION_STATUS_QUEUED,
    BOT_ACTION_STATUS_RUNNING,
    BOT_ACTION_TYPE_TRAFFIC_MSG,
    BOT_ACTION_TYPE_TRAFFIC_FUND,
    BOT_ACTION_TYPE_TRAFFIC_TX,
    BOT_FAUCET_USERNAME,
    BOT_MODE,
    BOT_RUNTIME_ACTIONS,
    BOT_RUNTIME_DOC_ID,
    BOT_RUNTIME_LEASE_MS,
    BOT_UNDERFUNDED_TEXT,
} from '@veyl/shared/bot/events';
import { bootRegistryBotAccount, closeBotAccount } from '@veyl/shared/bot/account';
import {
    cleanTrafficCount,
    cleanTrafficDelayMs,
} from '@veyl/shared/bot/traffic';
import { hasBotEchoRole, hasBotReviewRole, hasBotTrafficRole } from '@veyl/shared/bot/roles';
import {
    BOT_TRAFFIC_MESSAGES,
    BOT_TRAFFIC_REQUEST_AMOUNT_BUCKETS,
    BOT_TRAFFIC_REQUEST_WEIGHT,
    BOT_TRAFFIC_TEXT_WEIGHT,
} from '@veyl/shared/bot/traffic/messages';
import {
    BOT_TRAFFIC_TRANSFER_AMOUNT_SATS,
    BOT_TRAFFIC_TRANSFER_CONCURRENCY,
} from '@veyl/shared/bot/traffic/transfers';
import { clearBotChatPairCache, decryptBotChatSettings, decryptBotMsg, hasBotMsg, readBotMsgAttachment, sendBotMsg, setBotChatRetention, updateBotMsg, uploadBotAttachmentMsg } from '@veyl/shared/bot/chat';
import { getBotBalance, mirrorBotTransfer } from '@veyl/shared/bot/wallet';
import { getChatPeerPK } from '@veyl/shared/chat/ids';
import { makeOwnChatEntry, openOwnChatEntry, ownChatEntryId, sealOwnChatEntry } from '@veyl/shared/chat/entry';
import { openPing } from '@veyl/shared/chat/ping';
import { cleanBytes, toBytes } from '@veyl/shared/crypto/core';
import { hasStoredFileRef, isActionMutationMsg, isControlMsg, isReadReceiptMsg, isSystemMsg, makeHiddenCheckpoint, makeReadReceipt, makeReq, makeTxt, setReqTx } from '@veyl/shared/chat/messages';
import { getMessageKey, makeCid } from '@veyl/shared/chat/state';
import { cleanChatRetention, getMessageRetention, hasChatRetention } from '@veyl/shared/chat/ttl';
import {
    BOT_TRAFFIC_SESSION_WAIT_MS,
    BOT_REPLY_AFTER_READ_DELAY_MS,
} from '@veyl/shared/config';
import { banState } from '@veyl/shared/moderation';
import { resolveNetwork } from '@veyl/shared/network';
import { cleanText, lowerText, sameText } from '@veyl/shared/utils/text';
import { timestampMs } from '@veyl/shared/utils/time';
import { resolveWalletPK } from '@veyl/shared/wallet/keys';
import { sleep } from '@veyl/shared/utils/async';
import { SparkWallet, SparkWalletEvent } from '@buildonspark/spark-sdk';
import { randomInt, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import admin, { db, FieldValue, Timestamp, projectId } from './admin.js';
import { createSecretClient, loadProcessSecrets, readBotSecret } from './secrets.js';
import { cleanPing, sendPush as sendInboxPush } from '../../../functions/lib/inbox.js';

process.env.VEYL_BOT_RUNTIME = '1';

const SPARK_NETWORK = resolveNetwork(process.env);
const VERBOSE = process.env.VEYL_VERBOSE === '1';
const REPLACE_EXISTING_RUNTIME = process.env.VEYL_REPLACE_BOT_RUNTIME === '1';
const APNS_SECRET_IDS = Object.freeze(['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY_BASE64']);
const MAX_BOT_PEER_CACHE = 512;
const MAX_BOT_READ_CACHE = 2048;
const DEFAULT_FUND_BOT_AMOUNT_SATS = 1000;
const BOT_READS = 'reads';
const RUNTIME_HEARTBEAT_MS = 15000;
const RUNTIME_ACTIONS_SUPPORTED = Object.freeze([BOT_ACTION_TYPE_TRAFFIC_MSG, BOT_ACTION_TYPE_TRAFFIC_FUND, BOT_ACTION_TYPE_TRAFFIC_TX]);
const TRAFFIC_READ_RECEIPT_SCAN_LIMIT = 100;
const BOT_TRAFFIC_MESSAGE_CONCURRENCY = 32;
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

function adminBytes(value) {
    if (Buffer.isBuffer(value)) {
        return value;
    }
    if (typeof value?.toUint8Array === 'function') {
        return Buffer.from(value.toUint8Array());
    }
    try {
        return Buffer.from(toBytes(value, 'bot bytes'));
    } catch {
        return value;
    }
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

function verboseLog(...args) {
    if (VERBOSE) {
        console.log(...args);
    }
}

function safeLogId(value) {
    const text = cleanText(value);
    return text ? `${text.slice(0, 8)}:${text.length}` : null;
}

function firestoreLog(op, fields = {}) {
    verboseLog('[bot:firestore]', op, fields);
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
    delete payload.ttl;
    delete payload.from;
    delete payload.s;
    delete payload.cid;
    delete payload.retention;
    delete payload.pending;
    delete payload.failed;
    delete payload.peerChatPK;
    delete payload.actionId;
    delete payload.actionOp;
    delete payload.actionTarget;
    delete payload.actor;
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

function isRunningPid(pid) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function canReplaceRuntimeLease(data) {
    const pid = Number(data?.pid);
    return REPLACE_EXISTING_RUNTIME
        && data?.host === hostname()
        && Number.isInteger(pid)
        && pid > 0
        && !isRunningPid(pid);
}

function secretLoadStatus(error) {
    return error?.code != null ? `code ${error.code}` : 'unavailable';
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

function pickRandom(items) {
    if (!items.length) {
        return null;
    }
    return items[randomInt(items.length)];
}

function shuffled(items) {
    const out = [...(items || [])];
    for (let index = out.length - 1; index > 0; index -= 1) {
        const swapIndex = randomInt(index + 1);
        const current = out[index];
        out[index] = out[swapIndex];
        out[swapIndex] = current;
    }
    return out;
}

function senderKey(session) {
    return lowerText(session?.username) || cleanText(session?.uid) || 'unknown';
}

function incrementSender(map, session) {
    const key = senderKey(session);
    map.set(key, (map.get(key) || 0) + 1);
}

function senderCounts(map) {
    return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function botSessionKey(bot) {
    return [bot?.uid, bot?.chatPK, bot?.walletPK, timestampMs(bot?.restartAt, 0)].join(':');
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

function randomTrafficRequestAmount() {
    const bucket = pickWeighted(BOT_TRAFFIC_REQUEST_AMOUNT_BUCKETS);
    if (!bucket) {
        throw new Error('traffic request amount buckets are empty');
    }

    const min = Math.max(1, Math.floor(Number(bucket.min) || 0));
    const max = Math.max(min, Math.floor(Number(bucket.max) || min));
    const step = Math.max(1, Math.floor(Number(bucket.step) || 1));
    const steps = Math.floor((max - min) / step);
    return min + randomInt(steps + 1) * step;
}

function randomTrafficPayload() {
    const totalWeight = BOT_TRAFFIC_TEXT_WEIGHT + BOT_TRAFFIC_REQUEST_WEIGHT;
    if (totalWeight > 0 && randomInt(totalWeight) < BOT_TRAFFIC_REQUEST_WEIGHT) {
        return { payload: makeReq(String(randomTrafficRequestAmount())), request: true };
    }

    const text = pickRandom(BOT_TRAFFIC_MESSAGES);
    if (!text) {
        throw new Error('traffic message pool is empty');
    }
    return { payload: makeTxt(text), request: false };
}

function cleanTransferAmount(value, fallback = BOT_TRAFFIC_TRANSFER_AMOUNT_SATS) {
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
    firestoreLog('read block', { uid: safeLogId(uid), peerUid: safeLogId(peerUid) });
    const snap = await db.collection('users').doc(uid).collection('blocked').doc(peerUid).get();
    firestoreLog('read block done', { uid: safeLogId(uid), peerUid: safeLogId(peerUid), hit: snap.exists });
    return snap.exists;
}

async function isChatBanned(uid) {
    if (!uid) {
        return false;
    }
    firestoreLog('read moderation', { uid: safeLogId(uid) });
    const snap = await db.collection('moderation').doc(uid).get();
    return banState(snap.data()?.banned).chatBanned;
}

async function getProfile(uid) {
    if (!uid) {
        return null;
    }
    firestoreLog('read profile', { uid: safeLogId(uid) });
    const snap = await db.collection('profiles').doc(uid).get();
    if (!snap.exists) {
        firestoreLog('read profile done', { uid: safeLogId(uid), hit: false });
        return null;
    }
    const data = snap.data();
    firestoreLog('read profile done', { uid: safeLogId(uid), hit: true });
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

    async loadPushSecrets() {
        const result = await loadProcessSecrets(this.secretClient, projectId, APNS_SECRET_IDS).catch((error) => {
            console.warn('bot push APNS secrets unavailable', { status: secretLoadStatus(error) });
            return null;
        });
        if (!result) {
            return;
        }
        if (result.loaded.length) {
            console.info('bot push APNS secrets loaded', { count: result.loaded.length });
        }
        if (result.missing.length) {
            console.warn('bot push APNS secrets missing', { count: result.missing.length });
        }
    }

    async start() {
        if (this.running) {
            return;
        }

        this.running = true;
        this.stopped = false;
        await this.loadPushSecrets();
        await this.acquireRuntimeLease();
        await this.cancelStaleTrafficActions();
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
        firestoreLog('listen bots enabled');

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
        firestoreLog('listen runtime actions queued');

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

    async cancelStaleTrafficActions() {
        firestoreLog('read stale runtime actions');
        const snap = await runtimeRef().collection(BOT_RUNTIME_ACTIONS).where('status', 'in', [BOT_ACTION_STATUS_QUEUED, BOT_ACTION_STATUS_RUNNING]).get();
        if (snap.empty) {
            return;
        }

        const batch = db.batch();
        let cancelled = 0;
        for (const docSnap of snap.docs) {
            const data = docSnap.data() || {};
            if (![BOT_ACTION_TYPE_TRAFFIC_MSG, BOT_ACTION_TYPE_TRAFFIC_FUND, BOT_ACTION_TYPE_TRAFFIC_TX].includes(data.type)) {
                continue;
            }
            batch.set(
                docSnap.ref,
                {
                    status: BOT_ACTION_STATUS_CANCELLED,
                    cancelReason: 'runtime restarted',
                    result: {
                        type: data.type || null,
                        requested: Number.isFinite(data.count) ? data.count : 0,
                        sent: 0,
                        cancelled: true,
                        cancelReason: 'runtime restarted',
                        targetUid: data.targetUid || null,
                        targetUsername: data.targetUsername || null,
                        sourceUid: data.sourceUid || null,
                        sourceUsername: data.sourceUsername || null,
                        amountSats: Number.isFinite(data.amountSats) ? data.amountSats : null,
                        delayMs: Number.isFinite(data.delayMs) ? data.delayMs : 0,
                        durationMs: Number.isFinite(data.durationMs) ? data.durationMs : null,
                        errors: 0,
                        errorMessages: [],
                    },
                    finishedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
            );
            cancelled++;
        }
        if (!cancelled) {
            return;
        }
        firestoreLog('write stale runtime action cancels', { count: cancelled });
        await batch.commit();
        console.warn(`cancelled ${cancelled} stale bot traffic action${cancelled === 1 ? '' : 's'}`);
    }

    async acquireRuntimeLease() {
        const ref = runtimeRef();
        firestoreLog('transaction runtime lease');
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const data = snap.exists ? snap.data() : {};
            const heartbeatMs = timestampMs(data?.heartbeatAt, 0);
            const active = data?.running === true && heartbeatMs > Date.now() - BOT_RUNTIME_LEASE_MS;
            if (active && data?.runtimeId !== this.runtimeId && !canReplaceRuntimeLease(data)) {
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
            firestoreLog('write runtime heartbeat');
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
            if (action.type === BOT_ACTION_TYPE_TRAFFIC_MSG) {
                result = await this.runTrafficMessageAction(action);
            } else if (action.type === BOT_ACTION_TYPE_TRAFFIC_FUND) {
                result = await this.runTrafficFundAction(action);
            } else if (action.type === BOT_ACTION_TYPE_TRAFFIC_TX) {
                result = await this.runTrafficTransferAction(action);
            } else {
                throw new Error(`unsupported bot action: ${action.type || 'unknown'}`);
            }

            const status = result?.cancelled ? BOT_ACTION_STATUS_CANCELLED : BOT_ACTION_STATUS_DONE;
            firestoreLog('write runtime action result', { actionId: safeLogId(action.id), status });
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
            firestoreLog('write runtime action error', { actionId: safeLogId(action.id) });
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
        firestoreLog('transaction runtime action claim', { actionId: safeLogId(actionRef?.id) });
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

    activeTrafficSessions() {
        return [...this.sessions.values()].filter((session) => (
            session?.started &&
            !session.closing &&
            hasBotTrafficRole(session) &&
            session.chatJobs &&
            session.chatPK &&
            session.chatPrivKey
        ));
    }

    fundingSourceSession(action) {
        const uid = cleanText(action?.sourceUid);
        const username = lowerText(action?.sourceUsername || BOT_FAUCET_USERNAME);
        return [...this.sessions.values()].find((session) => {
            if (!session?.started || session.closing || !session.wallet || !session.chatJobs) {
                return false;
            }
            return (uid && session.uid === uid) || sameText(session.username, username);
        }) || null;
    }

    trafficMessageSourceSession(action) {
        const uid = cleanText(action?.sourceUid);
        const username = lowerText(action?.sourceUsername);
        if (!uid && !username) {
            return null;
        }
        return this.activeTrafficSessions().find((session) => (
            (uid && session.uid === uid) || (username && sameText(session.username, username))
        )) || null;
    }

    hasTrafficMessageSource(action) {
        return !!(cleanText(action?.sourceUid) || lowerText(action?.sourceUsername));
    }

    firstTrafficSession() {
        return this.activeTrafficSessions().sort((a, b) => senderKey(a).localeCompare(senderKey(b)))[0] || null;
    }

    async waitForTrafficSessions() {
        const deadline = Date.now() + BOT_TRAFFIC_SESSION_WAIT_MS;
        while (!this.stopped && Date.now() <= deadline) {
            const sessions = this.activeTrafficSessions();
            if (sessions.length) {
                return sessions;
            }
            await sleep(250);
        }
        throw new Error('no active bot sessions');
    }

    async waitForTrafficMessageSource(action) {
        const deadline = Date.now() + BOT_TRAFFIC_SESSION_WAIT_MS;
        const hasSource = this.hasTrafficMessageSource(action);
        while (!this.stopped && Date.now() <= deadline) {
            const session = hasSource ? this.trafficMessageSourceSession(action) : this.firstTrafficSession();
            if (session) {
                return session;
            }
            await sleep(250);
        }
        if (hasSource) {
            const label = action?.sourceUsername ? `@${action.sourceUsername}` : action?.sourceUid;
            throw new Error(`traffic source bot is not active: ${label}`);
        }
        throw new Error('no active bot sessions');
    }

    async waitForFundingSource(action) {
        const deadline = Date.now() + BOT_TRAFFIC_SESSION_WAIT_MS;
        while (!this.stopped && Date.now() <= deadline) {
            const session = this.fundingSourceSession(action);
            if (session) {
                return session;
            }
            await sleep(250);
        }

        const label = action?.sourceUsername ? `@${action.sourceUsername}` : action?.sourceUid || `@${BOT_FAUCET_USERNAME}`;
        throw new Error(`funding bot session is not active: ${label}`);
    }

    async runTrafficFundAction(action) {
        const amountSats = cleanTransferAmount(action.amountSats, DEFAULT_FUND_BOT_AMOUNT_SATS);
        const source = await this.waitForFundingSource(action);
        const sessions = (await this.waitForTrafficSessions()).filter((session) => session.uid !== source.uid && session.walletPK);

        const funded = [];
        const errors = [];
        let cancelled = false;
        for (const session of sessions) {
            if (this.stopped || await this.isActionCancelRequested(action)) {
                cancelled = true;
                break;
            }

            try {
                const txId = await queueMapJob(source.chatJobs, `fund:${session.uid}`, () => mirrorBotTransfer(source.wallet, session.walletPK, amountSats, SPARK_NETWORK));
                funded.push({ uid: session.uid, username: session.username || null, amountSats, txId });
                verboseLog(`bot traffic fund ${funded.length}/${sessions.length}: @${source.username} -> @${session.username} ${amountSats} sats`);
            } catch (error) {
                errors.push({ uid: session.uid, username: session.username || null, error: statusMessage(error) });
                console.warn(`bot traffic fund failed for @${session.username}`, error);
            }
            if (Number(action.delayMs) > 0) {
                await sleep(Number(action.delayMs));
            }
        }

        const balance = await this.refreshBalance(source);
        await this.touchBot(source.ref, {
            status: 'running',
            lastError: null,
            ...(balance != null ? { balance: String(balance) } : {}),
        });

        return {
            type: BOT_ACTION_TYPE_TRAFFIC_FUND,
            amountSats,
            requested: sessions.length,
            sent: funded.length,
            cancelled,
            sourceUid: source.uid,
            sourceUsername: source.username || null,
            delayMs: Number(action.delayMs) || 0,
            durationMs: null,
            bots: funded.map((entry) => entry.username).filter(Boolean),
            transfers: funded,
            txIds: funded.map((entry) => entry.txId).filter(Boolean),
            errors: errors.length,
            errorMessages: errors.slice(0, 20),
        };
    }

    async runTrafficTransferAction(action) {
        const count = cleanTrafficCount(action.count);
        const delayMs = cleanTrafficDelayMs(action.delayMs);
        const amountSats = BOT_TRAFFIC_TRANSFER_AMOUNT_SATS;
        const target = await getProfile(action.targetUid);
        const targetWalletPK = resolveWalletPK(target, SPARK_NETWORK);
        if (!target?.uid || !targetWalletPK) {
            throw new Error('traffic transfer target missing wallet identity');
        }
        if (target.bot) {
            throw new Error('traffic transfer target cannot be a bot');
        }

        await this.waitForTrafficSessions();

        const senders = new Map();
        const inFlight = new Set();
        const errors = [];
        const transfers = [];
        let sent = 0;
        let scheduled = 0;
        let cancelled = false;

        const waitForTransferSlot = async () => {
            while (inFlight.size >= BOT_TRAFFIC_TRANSFER_CONCURRENCY) {
                await Promise.race(inFlight);
            }
        };

        for (let index = 0; index < count; index++) {
            if (this.stopped || await this.isActionCancelRequested(action)) {
                cancelled = true;
                break;
            }

            await waitForTransferSlot();

            const sessions = this.activeTrafficSessions().filter((session) => session.wallet);
            if (!sessions.length) {
                throw new Error('no active funded bot sessions');
            }

            const session = pickRandom(sessions);
            scheduled++;
            const transfer = queueMapJob(session.chatJobs, '__wallet_transfer_traffic__', async () => {
                if (session.closing || this.stopped) {
                    throw new Error('bot session closed');
                }
                const txId = await mirrorBotTransfer(session.wallet, targetWalletPK, amountSats, SPARK_NETWORK);
                const balance = await this.refreshBalance(session);
                await this.touchBot(session.ref, {
                    status: 'running',
                    lastError: null,
                    ...(balance != null ? { balance: String(balance) } : {}),
                });
                return txId;
            })
                .then((txId) => {
                    sent++;
                    incrementSender(senders, session);
                    transfers.push({ uid: session.uid, username: session.username || null, amountSats, txId: txId || null });
                    if (sent === 1 || sent === count || sent % 10 === 0) {
                        verboseLog(`bot traffic tx ${sent}/${count}: ${amountSats} sats to @${target.username || target.uid}`);
                    }
                })
                .catch((error) => {
                    errors.push({ uid: session.uid, username: session.username || null, error: statusMessage(error) });
                    console.warn(`bot traffic tx failed for @${session.username}`, error);
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

        return {
            type: BOT_ACTION_TYPE_TRAFFIC_TX,
            requested: count,
            sent,
            scheduled,
            cancelled,
            errors: errors.length,
            errorMessages: errors.slice(0, 20),
            amountSats,
            delayMs,
            durationMs: Number.isFinite(action.durationMs) ? action.durationMs : count * delayMs,
            targetUid: target.uid,
            targetUsername: target.username || null,
            bots: [...new Set(transfers.map((entry) => entry.username).filter(Boolean))],
            senderCounts: senderCounts(senders),
            transfers,
            txIds: transfers.map((entry) => entry.txId).filter(Boolean),
        };
    }

    async runTrafficMessageAction(action) {
        const count = cleanTrafficCount(action.count);
        const delayMs = cleanTrafficDelayMs(action.delayMs);
        const target = await getProfile(action.targetUid);
        if (!target?.uid || !target?.chatPK) {
            throw new Error('traffic target missing chat identity');
        }
        if (target.bot) {
            throw new Error('traffic target cannot be a bot');
        }

        const solo = action.solo === true;
        const soloSession = solo ? await this.waitForTrafficMessageSource(action) : null;
        if (!soloSession) {
            await this.waitForTrafficSessions();
        }

        const senders = new Map();
        const sentChats = new Map();
        const messages = [];
        const errors = [];
        const jobs = new Set();
        let coverageSessions = [];
        let sent = 0;
        let requests = 0;
        let cancelled = false;

        const sendTrafficMessage = (session, message, chatId) => {
            const job = (async () => {
                try {
                    const result = await queueMapJob(session.chatJobs, chatId, async () => {
                        if (session.closing || this.stopped) {
                            throw new Error('bot session closed');
                        }
                        const result = await this.sendPayload(session, target.chatPK, message.payload, { receiverUid: target.uid });
                        sentChats.set(session.uid, result?.chatId || chatId);
                        return result;
                    });

                    incrementSender(senders, session);
                    messages.push({
                        uid: session.uid,
                        username: session.username || null,
                        chatId: result?.chatId || chatId,
                        msgId: result?.msgId || null,
                        request: message.request,
                    });
                    sent++;
                    if (message.request) {
                        requests++;
                    }
                } catch (error) {
                    errors.push({ uid: session.uid, username: session.username || null, error: statusMessage(error) });
                    console.warn(`bot traffic message failed for @${session.username}`, error);
                }
            })().finally(() => {
                jobs.delete(job);
            });
            jobs.add(job);
        };

        const nextMessageSession = () => {
            const sessions = soloSession ? [soloSession] : this.activeTrafficSessions();
            if (!sessions.length) {
                throw new Error('no active bot sessions');
            }
            if (soloSession) {
                return soloSession;
            }

            const activeUids = new Set(sessions.map((session) => session.uid).filter(Boolean));
            coverageSessions = coverageSessions.filter((session) => activeUids.has(session.uid) && !session.closing);
            if (!coverageSessions.length) {
                coverageSessions = shuffled(sessions);
            }

            const readyIndex = coverageSessions.findIndex((session) => !session.chatJobs.has(`${session.uid}:${target.chatPK}`));
            if (readyIndex >= 0) {
                const [session] = coverageSessions.splice(readyIndex, 1);
                return session;
            }

            return coverageSessions.shift() || pickRandom(sessions);
        };

        for (let index = 0; index < count; index++) {
            if (this.stopped || await this.isActionCancelRequested(action)) {
                cancelled = true;
                break;
            }

            const session = nextMessageSession();
            const message = randomTrafficPayload();
            const chatId = `${session.uid}:${target.chatPK}`;
            sendTrafficMessage(session, message, chatId);

            if (index + 1 < count) {
                await sleep(delayMs);
            }
            while (jobs.size >= BOT_TRAFFIC_MESSAGE_CONCURRENCY) {
                await Promise.race(jobs);
            }
        }

        await Promise.allSettled(jobs);

        const receiptResult = cancelled ? { sent: 0, errors: [] } : await this.sendTrafficReadReceipts(action, target, sentChats);

        return {
            type: BOT_ACTION_TYPE_TRAFFIC_MSG,
            requested: count,
            sent,
            solo,
            cancelled,
            delayMs,
            durationMs: Number.isFinite(action.durationMs) ? action.durationMs : count * delayMs,
            targetUid: target.uid,
            targetUsername: target.username || null,
            sourceUid: soloSession?.uid || null,
            sourceUsername: soloSession?.username || null,
            bots: [...new Set(messages.map((entry) => entry.username).filter(Boolean))],
            senderCounts: senderCounts(senders),
            messages,
            requests,
            readReceipts: receiptResult.sent,
            errors: errors.length + receiptResult.errors.length,
            errorMessages: [...errors, ...receiptResult.errors].slice(0, 20),
        };
    }

    async sendTrafficReadReceipts(action, target, sentChats) {
        let sent = 0;
        const errors = [];
        for (const [uid, chatId] of sentChats.entries()) {
            if (this.stopped) {
                return { sent, errors };
            }

            const session = this.sessions.get(uid);
            if (!session || session.closing) {
                continue;
            }

            try {
                const receipt = await this.findLatestPeerReceiptTarget(session, chatId, target.chatPK);
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
            } catch (error) {
                errors.push({ uid: session.uid, username: session.username || null, chatId, error: statusMessage(error) });
                console.warn(`bot traffic read receipt failed for @${session.username}`, error);
            }
        }
        return { sent, errors };
    }

    async findLatestPeerReceiptTarget(session, chatId, peerChatPK) {
        const entryId = ownChatEntryId(session.chatPrivKey, chatId);
        const entrySnap = await db.collection('users').doc(session.uid).collection('chats').doc(entryId).get().catch(() => null);
        const entry = entrySnap?.exists ? await openOwnChatEntry(session.chatPrivKey, entryId, entrySnap.data()?.body).catch(() => null) : null;
        const snap = await db.collection('chats').doc(chatId).collection('messages').orderBy('ts', 'desc').limit(TRAFFIC_READ_RECEIPT_SCAN_LIMIT).get();
        for (const msgSnap of snap.docs) {
            const data = msgSnap.data();
            const msg = await decryptBotMsg(data, session.chatPK, session.chatPrivKey, peerChatPK, { actors: entry?.actors, chatId }).catch(() => null);
            if (!msg || msg.s !== peerChatPK || isControlMsg(msg) || isSystemMsg(msg) || (msg.actionOp && msg.actionOp !== 'create')) {
                continue;
            }
            return {
                msgId: msgSnap.id,
                target: getMessageKey({ ...msg, id: msgSnap.id }),
                ts: msg.ts ?? data?.ts,
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
        const sessionKey = botSessionKey(bot);
        const current = this.sessions.get(bot.uid);

        if (current?.key === sessionKey) {
            current.ref = bot.ref;
            current.username = bot.username;
            current.resumeAtMs = timestampMs(bot.resumeAt, 0);
            current.restartAtMs = timestampMs(bot.restartAt, 0);
            current.mode = bot.mode || BOT_MODE;
            current.roles = bot.roles || {};
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
        session.restartAtMs = timestampMs(bot.restartAt, 0);
        session.mode = bot.mode || BOT_MODE;
        session.roles = bot.roles || {};

        if (session.started) {
            return;
        }

        session.started = true;
        session.chatJobs = new Map();
        session.chatRead = new Map();
        session.chatMessageUnsubs = new Map();

        this.attachWalletListeners(session);
        session.unsubscribeChats = this.subscribeChats(session);

        const balance = await this.refreshBalance(session);
        console.log(`bot @${session.username} ready | balance: ${balance} sats`);
        firestoreLog('write bot session ready', { uid: safeLogId(session.uid), username: session.username });
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
        const userRef = db.collection('users').doc(session.uid);
        firestoreLog('listen owner chats', { uid: safeLogId(session.uid), username: session.username });
        const unsubscribeChats = userRef.collection('chats').onSnapshot(
            (snap) => {
                for (const change of snap.docChanges()) {
                    if (change.type === 'removed') {
                        const data = change.doc.data();
                        void openOwnChatEntry(session.chatPrivKey, change.doc.id, data?.body)
                            .then((opened) => {
                                if (opened?.chatId) {
                                    session.chatRead?.delete(opened.chatId);
                                    this.closeChatMessageListener(session, opened.chatId);
                                }
                            })
                            .catch(() => {});
                        continue;
                    }

                    const data = change.doc.data();
                    const entry = openOwnChatEntry(session.chatPrivKey, change.doc.id, data?.body).catch(() => null);

                    void entry.then((opened) => {
                        if (!opened?.chatId || !opened?.peerChatPK) {
                            return;
                        }
                        const chat = {
                            id: opened.chatId,
                            ref: db.collection('chats').doc(opened.chatId),
                            peerChatPK: opened.peerChatPK,
                            settings: opened.settings,
                            actors: opened.actors || {},
                            ts: data?.ts,
                        };
                        this.closeChatMessageListener(session, chat.id);
                        this.watchChatMessages(session, chat);
                        return queueMapJob(session.chatJobs, chat.id, () => this.processChat(session, chat));
                    }).catch((error) => {
                        console.error(`bot @${session.username} chat entry ${change.doc.id} failed`, error);
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
        firestoreLog('listen inbox pings', { uid: safeLogId(session.uid), username: session.username });
        const unsubscribeInbox = userRef.collection('inbox').onSnapshot(
            (snap) => {
                for (const change of snap.docChanges()) {
                    if (change.type === 'removed') {
                        continue;
                    }
                    void this.processChatPing(session, change.doc).catch((error) => {
                        console.error(`bot @${session.username} chat ping ${change.doc.id} failed`, error);
                    });
                }
            },
            (error) => {
                console.error(`bot @${session.username} chat inbox failed`, error);
            }
        );
        return () => {
            unsubscribeChats?.();
            unsubscribeInbox?.();
        };
    }

    closeChatMessageListener(session, chatId) {
        const unsubscribe = session.chatMessageUnsubs?.get(chatId);
        if (!unsubscribe) {
            return;
        }
        try {
            unsubscribe();
        } catch {}
        session.chatMessageUnsubs.delete(chatId);
    }

    watchChatMessages(session, chat) {
        if (!session?.chatMessageUnsubs || !chat?.id || session.chatMessageUnsubs.has(chat.id)) {
            return;
        }

        firestoreLog('listen latest chat message', { uid: safeLogId(session.uid), chatId: safeLogId(chat.id) });
        const unsubscribe = chat.ref
            .collection('messages')
            .orderBy('ts', 'desc')
            .limit(1)
            .onSnapshot(
                (snap) => {
                    const latest = snap.docs?.[0]?.data?.();
                    if (!latest?.ts) {
                        return;
                    }
                    const latestChat = {
                        ...chat,
                        ts: latest.ts,
                    };
                    void queueMapJob(session.chatJobs, chat.id, () => this.processChat(session, latestChat)).catch((error) => {
                        console.error(`bot @${session.username} chat messages ${chat.id} failed`, error);
                    });
                },
                (error) => {
                    console.error(`bot @${session.username} chat messages ${chat.id} listener failed`, error);
                    this.closeChatMessageListener(session, chat.id);
                }
            );
        session.chatMessageUnsubs.set(chat.id, unsubscribe);
    }

    async processChatPing(session, pingDoc) {
        try {
            const ping = await openPing(session.chatPK, session.chatPrivKey, pingDoc.data());
            if (!ping?.pair?.chatId || !ping?.payload?.senderChatPK || !ping?.payload?.actorPK) {
                throw new Error('invalid chat ping');
            }
            const peerUid = await this.resolvePingUid(ping.payload);
            const entryId = ownChatEntryId(session.chatPrivKey, ping.pair.chatId);
            const entryRef = db.collection('users').doc(session.uid).collection('chats').doc(entryId);
            firestoreLog('read inbox chat entry', { uid: safeLogId(session.uid), entryId: safeLogId(entryId), chatId: safeLogId(ping.pair.chatId) });
            const existingSnap = await entryRef.get().catch(() => null);
            const existing = existingSnap?.exists ? await openOwnChatEntry(session.chatPrivKey, entryId, existingSnap.data()?.body).catch(() => null) : null;
            const actors = {
                ...(existing?.actors || {}),
                [ping.pair.chatPK]: ping.pair.actor.publicKey,
                [ping.payload.senderChatPK]: ping.payload.actorPK,
            };
            const entry = makeOwnChatEntry(ping.pair, {
                peerUid: peerUid || existing?.peerUid,
                actors,
                settings: existing?.settings,
                preview: existing?.preview,
            });
            await entryRef.set(
                {
                    body: adminBytes(await sealOwnChatEntry(session.chatPrivKey, entryId, entry)),
                    ts: new Date(timestampMs(ping.payload?.ts, Date.now())),
                },
                { merge: true }
            );
            firestoreLog('write inbox chat entry', { uid: safeLogId(session.uid), entryId: safeLogId(entryId), chatId: safeLogId(ping.pair.chatId) });
        } finally {
            firestoreLog('delete inbox ping', { uid: safeLogId(session.uid), pingId: safeLogId(pingDoc?.id) });
            await pingDoc.ref.delete().catch(() => {});
        }
    }

    async resolvePingUid(payload) {
        const senderChatPK = cleanText(payload?.senderChatPK);
        const claimedUid = cleanText(payload?.senderUid);
        if (!senderChatPK) {
            return null;
        }
        if (claimedUid) {
            firestoreLog('read profile for ping claim', { uid: safeLogId(claimedUid) });
            const snap = await db.collection('profiles').doc(claimedUid).get().catch(() => null);
            if (!sameText(snap?.data?.()?.chatPK, senderChatPK)) {
                throw new Error('ping sender uid mismatch');
            }
            return claimedUid;
        }
        firestoreLog('read profile by ping chatPK', { chatPK: safeLogId(senderChatPK) });
        const profileSnap = await db.collection('profiles').where('chatPK', '==', senderChatPK).limit(1).get();
        return profileSnap.docs?.[0]?.id || null;
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
            firestoreLog('read bot chat ack', { uid: safeLogId(session.uid), chatId: safeLogId(chatId) });
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
        firestoreLog('write bot chat ack', { uid: safeLogId(session.uid), chatId: safeLogId(chatId) });
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
        const sessionKey = botSessionKey(bot);
        if (current?.key === sessionKey) {
            current.ref = bot.ref;
            current.username = bot.username;
            current.resumeAtMs = timestampMs(bot.resumeAt, 0);
            current.restartAtMs = timestampMs(bot.restartAt, 0);
            current.mode = bot.mode || BOT_MODE;
            current.roles = bot.roles || {};
            return current;
        }

        await this.closeSession(bot.uid);

        const secret = await readBotSecret(this.secretClient, projectId, bot.username);
        try {
            const account = await bootRegistryBotAccount(secret.masterSeed, secret.registry, {
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
                restartAtMs: timestampMs(bot.restartAt, 0),
                mode: bot.mode || BOT_MODE,
                roles: bot.roles || {},
                started: false,
                closing: false,
                balance: null,
                unsubscribeChats: null,
                chatMessageUnsubs: new Map(),
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
            cleanBytes(secret.masterSeed, secret.registry?.iv, secret.registry?.ct);
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

        if (session.chatMessageUnsubs) {
            for (const unsubscribe of session.chatMessageUnsubs.values()) {
                try {
                    unsubscribe?.();
                } catch {}
            }
            session.chatMessageUnsubs.clear();
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

        firestoreLog('read peer by chatPK', { chatPK: safeLogId(key) });
        const profileSnap = await db.collection('profiles').where('chatPK', '==', key).limit(2).get();
        const peer = profileSnap.docs.length === 1 ? { uid: profileSnap.docs[0].id, ...profileSnap.docs[0].data() } : null;
        setLimitedMap(this.chatPeers, key, peer, MAX_BOT_PEER_CACHE);
        return peer;
    }

    async processChat(session, chat) {
        if (session.closing) {
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

        firestoreLog('read chat messages', { uid: safeLogId(session.uid), chatId: safeLogId(chat.id), sinceMs });
        let msgsSnap = await chat.ref.collection('messages').where('ts', '>', Timestamp.fromMillis(sinceMs)).orderBy('ts', 'asc').get();
        if (msgsSnap.empty && chatRecencyMs > sinceMs) {
            // A brand-new chat can surface in the parent collection just before its
            // first message becomes readable via the subcollection query.
            await sleep(250);
            firestoreLog('read chat messages retry', { uid: safeLogId(session.uid), chatId: safeLogId(chat.id), sinceMs });
            msgsSnap = await chat.ref.collection('messages').where('ts', '>', Timestamp.fromMillis(sinceMs)).orderBy('ts', 'asc').get();
        }
        firestoreLog('read chat messages done', { uid: safeLogId(session.uid), chatId: safeLogId(chat.id), count: msgsSnap.docs.length });
        if (msgsSnap.empty) {
            return;
        }

        const settings = await decryptBotChatSettings(chat?.settings, session.chatPK, session.chatPrivKey, peerChatPK);
        if (!settings) {
            return;
        }
        const storedRetention = cleanChatRetention(settings.retention);
        let effectiveRetention = storedRetention;
        let persistRetention = null;
        const adoptRetention = (value) => {
            const nextRetention = cleanChatRetention(value);
            effectiveRetention = nextRetention;
            persistRetention = nextRetention !== storedRetention ? nextRetention : null;
            return nextRetention;
        };
        const latestMs = timestampMs(msgsSnap.docs[msgsSnap.docs.length - 1]?.data()?.ts, 0);
        let readMs = sinceMs;
        const replies = [];
        let receipt = null;
        let peerReadReceipt = null;

        for (const msgSnap of msgsSnap.docs) {
            if (session.closing) {
                return;
            }

            const msgData = msgSnap.data();
            const msgMs = timestampMs(msgData?.ts, 0);

            const contextBase = {
                chatId: chat.id,
                msgId: msgSnap.id,
                msgTs: msgData?.ts,
                peerChatPK,
                actors: chat.actors || {},
            };
            const msg = await this.decryptChatMessage(
                session,
                contextBase,
                msgData
            );
            if (msg?.s !== peerChatPK) {
                readMs = Math.max(readMs, msgMs);
                continue;
            }
            const messageRetention = getMessageRetention(msg, effectiveRetention);
            if (hasChatRetention(msg?.retention)) {
                adoptRetention(messageRetention);
            }
            const context = {
                ...contextBase,
                retention: messageRetention,
            };
            if (isSystemMsg(msg)) {
                adoptRetention(msg.retention);
                readMs = Math.max(readMs, msgMs);
                continue;
            }
            if (isReadReceiptMsg(msg)) {
                const target = cleanText(msg.upto);
                if (target) {
                    peerReadReceipt = { context, target };
                }
                readMs = Math.max(readMs, msgMs);
                continue;
            }
            if (isControlMsg(msg) || isActionMutationMsg(msg)) {
                readMs = Math.max(readMs, msgMs);
                continue;
            }
            if (msg) {
                replies.push({ context, msg });
                receipt = {
                    context,
                    target: getMessageKey({ ...msg, id: msgSnap.id }),
                };
            }

            readMs = Math.max(readMs, msgMs);
        }

        if (persistRetention) {
            await setBotChatRetention(db, FieldValue, session.uid, session.chatPK, session.chatPrivKey, peerChatPK, persistRetention, { chatId: chat.id }).then((savedRetention) => {
                chat.settings = { ...(chat.settings || {}), retention: savedRetention };
            }).catch((error) => {
                console.warn('bot retention update failed', chat.id, statusMessage(error));
            });
        }

        if (!replies.length && !peerReadReceipt && !receipt) {
            await this.ackChat(session, chat.id, readMs);
            return;
        }

        const peer = await this.resolvePeerByChatPK(peerChatPK);
        if (!peer?.uid) {
            if (!replies.length && !receipt) {
                await this.ackChat(session, chat.id, readMs);
            }
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

        if (peerReadReceipt) {
            await this.sendHiddenCheckpoint(session, peerChatPK, peerReadReceipt.target, peerReadReceipt.context.retention, peerReadReceipt.context).catch((error) => {
                console.warn('bot peer-read hidden checkpoint failed', chat.id, statusMessage(error));
            });
        }

        if (receipt) {
            await this.sendReadReceipt(session, peerChatPK, receipt.target, receipt.context.retention, receipt.context).catch((error) => {
                console.warn('bot read receipt failed', chat.id, statusMessage(error));
            });
            await this.sendHiddenCheckpoint(session, peerChatPK, receipt.target, receipt.context.retention, receipt.context).catch((error) => {
                console.warn('bot hidden checkpoint failed', chat.id, statusMessage(error));
            });
        }

        if (!replies.length || !hasBotEchoRole(session)) {
            await this.ackChat(session, chat.id, readMs);
            return;
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

    async decryptChatMessage(session, context, msgData) {
        return decryptBotMsg(msgData, session.chatPK, session.chatPrivKey, context.peerChatPK, { actors: context.actors, chatId: context.chatId }).catch(() => null);
    }

    async replyToChatMessage(session, context, msg) {
        if (hasBotReviewRole(session)) {
            await this.replyAsReviewBot(session, context, msg);
            return;
        }
        await this.echoChatMessage(session, context, msg);
    }

    async replyAsReviewBot(session, context, msg) {
        await this.echoChatMessage(session, context, msg);
    }

    async echoChatMessage(session, context, msg) {
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
            }, {
                chatId: context.chatId,
                msgId,
                retention: context.retention,
                senderUid: session.uid,
                receiverUid: context.peerUid,
                sendPush: (recipientUid, ping) => this.sendPush(session, recipientUid, ping),
            });
            return;
        }

        await this.sendPayload(session, context.peerChatPK, cleanPayload(msg), {
            chatId: context.chatId,
            cid: botReplyCid(context, 'reply'),
            msgId: botReplyId(context, 'reply'),
            retention: context.retention,
            receiverUid: context.peerUid,
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
                chatId: context.chatId,
                cid: botReplyCid(context, 'funds'),
                msgId: botReplyId(context, 'funds'),
                retention: context.retention,
                receiverUid: context.peerUid,
            });
            return;
        }

        const txId = await mirrorBotTransfer(session.wallet, peerWalletPK, amountSats, SPARK_NETWORK);
        const patched = { ...setReqTx(msg, txId), cid: msg.cid };

        try {
            await updateBotMsg(db, context.chatId, context.msgId, session.chatPK, session.chatPrivKey, context.peerChatPK, patched);
        } catch (error) {
            console.warn('bot request patch failed', context.chatId, statusMessage(error));
        }

        await this.sendPayload(session, context.peerChatPK, makeReq(amount), {
            chatId: context.chatId,
            cid: botReplyCid(context, 'req'),
            msgId: botReplyId(context, 'req'),
            retention: context.retention,
            receiverUid: context.peerUid,
        });

        const nextBalance = await this.refreshBalance(session);
        await this.touchBot(session.ref, {
            status: 'running',
            lastError: null,
            ...(nextBalance != null ? { balance: String(nextBalance) } : {}),
        });
    }

    async sendPush(session, recipientUid, ping) {
        return sendInboxPush({
            senderUid: session.uid,
            recipientUid,
            ping: cleanPing(ping),
        });
    }

    async sendPayload(session, peerChatPK, payload, options = {}) {
        return sendBotMsg(db, FieldValue, session.chatPK, session.chatPrivKey, peerChatPK, {
            ...payload,
            cid: options.cid || makeCid(),
        }, {
            ...(options.msgId ? { msgId: options.msgId } : {}),
            ...(options.chatId ? { chatId: options.chatId } : {}),
            ...(options.linkId ? { linkId: options.linkId } : {}),
            retention: options.retention,
            senderUid: session.uid,
            receiverUid: options.receiverUid,
            sendPush: (recipientUid, ping) => this.sendPush(session, recipientUid, ping),
        });
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
            { updatePreview: false, retention, senderUid: session.uid, ...(context.chatId ? { chatId: context.chatId } : {}), ...(msgId ? { msgId } : {}) }
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
            { updatePreview: false, retention, senderUid: session.uid, ...(context.chatId ? { chatId: context.chatId } : {}), ...(msgId ? { msgId } : {}) }
        );
    }
}
