import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { DAY_MS } from './ratelimit.js';
import { db, Timestamp } from './admin.js';

const COLLECTION = 'usage_quotas';
const TTL_GRACE_MS = 2 * DAY_MS;

function hash(value) {
    return createHash('sha256').update(String(value)).digest('base64url');
}

function cleanName(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function cleanKeyPart(value) {
    const str = String(value ?? '').trim();
    return str ? str.slice(0, 512) : '';
}

export function usageQuotaKey(...parts) {
    return parts.map(cleanKeyPart).filter(Boolean).join('\n');
}

export function uidUsageQuotaKey(uid, ...parts) {
    return usageQuotaKey('uid', uid, ...parts);
}

export function cleanQuotaAmount(value) {
    const amount = Math.ceil(Number(value));
    if (!Number.isInteger(amount) || amount < 1) {
        throw new HttpsError('invalid-argument', 'invalid quota amount');
    }
    return amount;
}

export function makeUsageQuota(rule, nowMs = Date.now()) {
    const name = cleanName(rule?.name);
    const key = cleanKeyPart(rule?.key);
    const limit = Math.floor(Number(rule?.limit));
    const windowMs = Math.floor(Number(rule?.windowMs));
    if (!name || !key || limit < 1 || windowMs < 1) {
        throw new Error('invalid usage quota rule');
    }

    const bucketMs = Math.floor(nowMs / windowMs) * windowMs;
    const bucketEndMs = bucketMs + windowMs;
    const keyHash = hash(key);
    const docHash = hash(`${name}\n${keyHash}\n${windowMs}\n${bucketMs}`).slice(0, 48);
    return {
        name,
        ref: db.collection(COLLECTION).doc(`${name}_${docHash}`),
        keyHash,
        limit,
        windowMs,
        bucketMs,
        bucketEndMs,
    };
}

export function quotaUsed(snap) {
    const used = snap.exists && Number.isInteger(snap.data()?.used) ? snap.data().used : 0;
    return Math.max(0, used);
}

export function assertQuotaRoom(item, snap, amount, nowMs = Date.now()) {
    const used = quotaUsed(snap);
    if (used + amount <= item.limit) {
        return used;
    }
    throw new HttpsError('resource-exhausted', 'quota exceeded', {
        name: item.name,
        retryAfter: Math.max(1, Math.ceil((item.bucketEndMs - nowMs) / 1000)),
        limit: item.limit,
        used,
        requested: amount,
    });
}

export function writeQuotaReservation(tx, item, snap, amount, nowMs = Date.now()) {
    const used = quotaUsed(snap);
    tx.set(
        item.ref,
        {
            name: item.name,
            keyHash: item.keyHash,
            bucket: Timestamp.fromMillis(item.bucketMs),
            windowMs: item.windowMs,
            limit: item.limit,
            used: used + amount,
            ttl: Timestamp.fromMillis(item.bucketEndMs + TTL_GRACE_MS),
            updatedAt: Timestamp.fromMillis(nowMs),
        },
        { merge: true }
    );
}

export async function reserveUsageQuota(rule, amountValue) {
    const amount = cleanQuotaAmount(amountValue);
    const nowMs = Date.now();
    const item = makeUsageQuota(rule, nowMs);

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(item.ref);
        assertQuotaRoom(item, snap, amount, nowMs);
        writeQuotaReservation(tx, item, snap, amount, nowMs);
    });
}
