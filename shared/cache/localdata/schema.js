'use client';

import { resumeTargetFromPath } from '../../navigation/resume.js';
import { cleanText } from '../../utils/text.js';
import { makeTimestamp, timestampMs } from '../../utils/time.js';

export const LOCAL_DATA_CACHE_VERSION = 2;
export const LOCAL_DATA_CACHE_LABEL = 'local-cache-v2';

export function emptyPayload() {
    return {
        version: LOCAL_DATA_CACHE_VERSION,
        savedAt: 0,
        chatsSavedAt: 0,
        chatsById: {},
        transfersById: {},
        transferIds: [],
        transferWalletPK: null,
        transferHistoryComplete: false,
        transferNextOffset: 0,
        transferOldestMs: null,
        profilesByUid: {},
        mediaByKey: {},
        resumeRoute: null,
        lastCameraFacing: null,
    };
}

export function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function jsonClean(value) {
    if (value == null) {
        return value;
    }
    if (typeof value === 'bigint') {
        return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
    }
    if (typeof value !== 'object') {
        return value;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value.map(jsonClean).filter((item) => item !== undefined);
    }

    const out = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'function' || item === undefined) {
            continue;
        }
        const clean = jsonClean(item);
        if (clean !== undefined) {
            out[key] = clean;
        }
    }
    return out;
}

export function reviveTs(value) {
    const ms = timestampMs(value, null, { positive: true });
    return ms == null ? null : makeTimestamp(ms);
}

export function draftPayload(value) {
    const input = normalizePayload(value);
    return {
        ...input,
        chatsById: { ...input.chatsById },
        transfersById: { ...input.transfersById },
        transferIds: [...input.transferIds],
        profilesByUid: { ...input.profilesByUid },
        mediaByKey: { ...input.mediaByKey },
    };
}

export function normalizePayload(value) {
    const input = isObject(value) ? value : {};
    return {
        ...emptyPayload(),
        version: LOCAL_DATA_CACHE_VERSION,
        savedAt: Number.isFinite(input.savedAt) ? input.savedAt : 0,
        chatsSavedAt: Number.isFinite(input.chatsSavedAt) ? input.chatsSavedAt : 0,
        chatsById: isObject(input.chatsById) ? input.chatsById : {},
        transfersById: isObject(input.transfersById) ? input.transfersById : {},
        transferIds: Array.isArray(input.transferIds) ? input.transferIds.filter(Boolean) : [],
        transferWalletPK: cleanText(input.transferWalletPK) || null,
        transferHistoryComplete: input.transferHistoryComplete === true,
        transferNextOffset: Number.isFinite(input.transferNextOffset) ? input.transferNextOffset : 0,
        transferOldestMs: Number.isFinite(input.transferOldestMs) ? input.transferOldestMs : null,
        profilesByUid: isObject(input.profilesByUid) ? input.profilesByUid : {},
        mediaByKey: isObject(input.mediaByKey) ? input.mediaByKey : {},
        resumeRoute: cleanResumeRoute(input.resumeRoute),
        lastCameraFacing: cleanCameraFacing(input.lastCameraFacing),
    };
}

export function cleanResumeRoute(route) {
    return resumeTargetFromPath(cleanText(route))?.route ?? null;
}

export function cleanCameraFacing(facing) {
    const value = cleanText(facing);
    return value === 'front' || value === 'back' ? value : null;
}
