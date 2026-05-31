import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { db, Timestamp } from './admin.js';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const COLLECTION = 'rate_limits';
const TTL_GRACE_MS = 2 * DAY_MS;
const UNKNOWN_IP = 'unknown';

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

function headerValue(headers, name) {
    const value = headers?.[name] ?? headers?.[name.toLowerCase()];
    if (Array.isArray(value)) {
        return value.find((item) => typeof item === 'string' && item.trim()) || '';
    }
    return typeof value === 'string' ? value : '';
}

function firstForwardedIp(value) {
    return value
        .split(',')
        .map((item) => item.trim())
        .find(Boolean);
}

function cleanIp(value) {
    const ip = String(value ?? '')
        .trim()
        .replace(/^::ffff:/, '');
    return ip || UNKNOWN_IP;
}

export function callableIp(context) {
    const request = context?.rawRequest;
    const headers = request?.headers || {};
    const forwarded = firstForwardedIp(headerValue(headers, 'x-forwarded-for'));
    return cleanIp(request?.ip || forwarded || headerValue(headers, 'x-real-ip') || request?.socket?.remoteAddress);
}

export function limitKey(...parts) {
    const clean = parts.map(cleanKeyPart).filter(Boolean);
    return clean.join('\n');
}

export function ipLimitKey(context, ...parts) {
    return limitKey('ip', callableIp(context), ...parts);
}

export function uidLimitKey(uid, ...parts) {
    return limitKey('uid', uid, ...parts);
}

export function valueLimitKey(kind, value, ...parts) {
    return limitKey(kind, value, ...parts);
}

function cleanRule(rule, nowMs) {
    const name = cleanName(rule?.name);
    const key = cleanKeyPart(rule?.key);
    const limit = Math.floor(Number(rule?.limit));
    const windowMs = Math.floor(Number(rule?.windowMs));
    if (!name || !key || limit < 1 || windowMs < 1) {
        throw new Error('invalid rate limit rule');
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

export async function limitCallable(context, rules) {
    const nowMs = Date.now();
    const items = (Array.isArray(rules) ? rules : [rules]).map((rule) => cleanRule(rule, nowMs));

    await db.runTransaction(async (tx) => {
        const snaps = await Promise.all(items.map((item) => tx.get(item.ref)));
        const blocked = snaps
            .map((snap, index) => {
                const item = items[index];
                const count = Number.isInteger(snap.data()?.count) ? snap.data().count : 0;
                return count >= item.limit
                    ? {
                          name: item.name,
                          retryAfter: Math.max(1, Math.ceil((item.bucketEndMs - nowMs) / 1000)),
                      }
                    : null;
            })
            .filter(Boolean)
            .sort((a, b) => b.retryAfter - a.retryAfter)[0];

        if (blocked) {
            throw new HttpsError('resource-exhausted', 'rate limit', blocked);
        }

        items.forEach((item, index) => {
            const snap = snaps[index];
            const count = Number.isInteger(snap.data()?.count) ? snap.data().count : 0;
            tx.set(
                item.ref,
                {
                    name: item.name,
                    keyHash: item.keyHash,
                    bucket: Timestamp.fromMillis(item.bucketMs),
                    windowMs: item.windowMs,
                    limit: item.limit,
                    count: count + 1,
                    ttl: Timestamp.fromMillis(item.bucketEndMs + TTL_GRACE_MS),
                    updatedAt: Timestamp.fromMillis(nowMs),
                },
                { merge: true }
            );
        });
    });
}
