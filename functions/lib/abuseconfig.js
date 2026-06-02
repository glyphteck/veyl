import { DAY_MS, HOUR_MS, MINUTE_MS } from './ratelimit.js';

export const KIB_BYTES = 1024;
export const MIB_BYTES = 1024 * KIB_BYTES;

export const ACCOUNT_CREATE_IP_MINUTE_LIMIT = 2;
export const ACCOUNT_CREATE_IP_HOUR_LIMIT = 6;
export const ACCOUNT_CREATE_IP_DAY_LIMIT = 20;

export const NEW_ACCOUNT_WINDOW_MS = 7 * DAY_MS;
export const NEW_ACCOUNT_UPLOAD_BYTES_PER_DAY = 50 * MIB_BYTES;
export const ESTABLISHED_ACCOUNT_UPLOAD_BYTES_PER_DAY = 250 * MIB_BYTES;

export const CHAT_MEDIA_UPLOAD_RESERVATION_TTL_MS = 15 * MINUTE_MS;
export const CHAT_MEDIA_CONTENT_TYPE = 'application/octet-stream';

export const CHAT_MEDIA_RESERVE_UID_MINUTE_LIMIT = 30;
export const CHAT_MEDIA_RESERVE_UID_HOUR_LIMIT = 240;
export const CHAT_MEDIA_RESERVE_UID_DAY_LIMIT = 1000;

export const REPORT_EVIDENCE_UPLOAD_RESERVATION_TTL_MS = 15 * MINUTE_MS;
export const REPORT_EVIDENCE_RESERVE_UID_MINUTE_LIMIT = 10;
export const REPORT_EVIDENCE_RESERVE_UID_HOUR_LIMIT = 40;
export const REPORT_EVIDENCE_RESERVE_UID_DAY_LIMIT = 120;

export const accountCreateIpLimitRules = (key) => [
    { name: 'account-create-ip-minute', key, limit: ACCOUNT_CREATE_IP_MINUTE_LIMIT, windowMs: MINUTE_MS },
    { name: 'account-create-ip-hour', key, limit: ACCOUNT_CREATE_IP_HOUR_LIMIT, windowMs: HOUR_MS },
    { name: 'account-create-ip-day', key, limit: ACCOUNT_CREATE_IP_DAY_LIMIT, windowMs: DAY_MS },
];

export const chatMediaReserveLimitRules = (key) => [
    { name: 'reserve-chat-media-uid-minute', key, limit: CHAT_MEDIA_RESERVE_UID_MINUTE_LIMIT, windowMs: MINUTE_MS },
    { name: 'reserve-chat-media-uid-hour', key, limit: CHAT_MEDIA_RESERVE_UID_HOUR_LIMIT, windowMs: HOUR_MS },
    { name: 'reserve-chat-media-uid-day', key, limit: CHAT_MEDIA_RESERVE_UID_DAY_LIMIT, windowMs: DAY_MS },
];

export const reportEvidenceReserveLimitRules = (key) => [
    { name: 'reserve-report-evidence-uid-minute', key, limit: REPORT_EVIDENCE_RESERVE_UID_MINUTE_LIMIT, windowMs: MINUTE_MS },
    { name: 'reserve-report-evidence-uid-hour', key, limit: REPORT_EVIDENCE_RESERVE_UID_HOUR_LIMIT, windowMs: HOUR_MS },
    { name: 'reserve-report-evidence-uid-day', key, limit: REPORT_EVIDENCE_RESERVE_UID_DAY_LIMIT, windowMs: DAY_MS },
];
