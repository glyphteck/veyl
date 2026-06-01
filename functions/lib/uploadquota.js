import admin from './admin.js';
import { DAY_MS } from './ratelimit.js';
import { ESTABLISHED_ACCOUNT_UPLOAD_BYTES_PER_DAY, NEW_ACCOUNT_UPLOAD_BYTES_PER_DAY, NEW_ACCOUNT_WINDOW_MS } from './abuseconfig.js';
import { makeUsageQuota, uidUsageQuotaKey } from './usagequota.js';

function authCreationMs(userRecord) {
    const ms = Date.parse(userRecord?.metadata?.creationTime || '');
    return Number.isFinite(ms) ? ms : Date.now();
}

async function accountAgeMs(uid, nowMs) {
    const userRecord = await admin.auth().getUser(uid);
    return Math.max(0, nowMs - authCreationMs(userRecord));
}

function uploadQuotaLimit(ageMs) {
    return ageMs < NEW_ACCOUNT_WINDOW_MS ? NEW_ACCOUNT_UPLOAD_BYTES_PER_DAY : ESTABLISHED_ACCOUNT_UPLOAD_BYTES_PER_DAY;
}

export async function makeAccountUploadQuota(uid, nowMs = Date.now()) {
    const ageMs = await accountAgeMs(uid, nowMs);
    const dailyLimit = uploadQuotaLimit(ageMs);
    return {
        quota: makeUsageQuota(
            {
                name: 'account-upload-bytes-day',
                key: uidUsageQuotaKey(uid, 'account-upload'),
                limit: dailyLimit,
                windowMs: DAY_MS,
            },
            nowMs
        ),
        dailyLimit,
        newAccount: ageMs < NEW_ACCOUNT_WINDOW_MS,
    };
}
