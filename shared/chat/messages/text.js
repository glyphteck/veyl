import { MAX_TXT_CHARS } from './types.js';
import { retentionPatch } from '../ttl.js';
import { cleanText } from '../../utils/text.js';

const DOMAIN_LABEL_PATTERN = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const DOMAIN_TLD_PATTERN = '(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})';
const DOMAIN_PATTERN = `${DOMAIN_LABEL_PATTERN}(?:\\.${DOMAIN_LABEL_PATTERN})*\\.${DOMAIN_TLD_PATTERN}`;
const EMAIL_LOCAL_PATTERN = "[a-z0-9.!#$%&'*+/=?^_{|}~-]+";
const EMAIL_PATTERN = `${EMAIL_LOCAL_PATTERN}@${DOMAIN_PATTERN}`;
const EMAIL_LINK_PATTERN = new RegExp(`^${EMAIL_PATTERN}$`, 'i');
const MAILTO_LINK_PATTERN = new RegExp(`^mailto:(${EMAIL_PATTERN})$`, 'i');
const BARE_LINK_PATTERN = new RegExp(`^${DOMAIN_PATTERN}(?=[:/?#]|$)`, 'i');
const LINK_PATTERN = new RegExp(`mailto:${EMAIL_PATTERN}|${EMAIL_PATTERN}|https?:\\/\\/[^\\s<>"'\`]+|${DOMAIN_PATTERN}(?=[:/?#]|$)[^\\s<>"'\`]*`, 'gi');
const LINK_START_BLOCKER = /[a-z0-9._@/-]/i;
const LINK_BAD_CHARS = /[<>"'`]/;
const LINK_TRAILING_PUNCT = /[),.;!?]+$/;

export function hasText(value) {
    return cleanText(value).length > 0;
}

function canStartLink(value, index) {
    return index <= 0 || !LINK_START_BLOCKER.test(value[index - 1]);
}

function hasUsableUrlHost(url) {
    const hostname = String(url?.hostname ?? '');
    return !!hostname && !hostname.startsWith('.') && !hostname.endsWith('.') && !hostname.includes('..');
}

function getCandidateHostname(value) {
    const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1] || '';
    return authority.replace(/^[^@]*@/, '').replace(/:\d+$/, '');
}

function getMailUrl(value) {
    const mailto = MAILTO_LINK_PATTERN.exec(value);
    const email = mailto?.[1] || (EMAIL_LINK_PATTERN.test(value) ? value : '');
    if (!email || email.startsWith('.') || email.includes('..') || email.includes('.@')) {
        return '';
    }
    return `mailto:${email}`;
}

function charLength(value) {
    return Array.from(String(value ?? '')).length;
}

export function getLinkUrl(value) {
    const raw = cleanText(value);
    if (!raw || /\s/.test(raw)) {
        return '';
    }

    const mailUrl = getMailUrl(raw);
    if (mailUrl) {
        return mailUrl;
    }

    const candidate = /^https?:\/\//i.test(raw) ? raw : BARE_LINK_PATTERN.test(raw) ? `https://${raw}` : raw;
    if (!/^https?:\/\//i.test(candidate) || LINK_BAD_CHARS.test(candidate)) {
        return '';
    }

    if (typeof URL === 'function') {
        try {
            const url = new URL(candidate);
            return (url.protocol === 'http:' || url.protocol === 'https:') && hasUsableUrlHost(url) ? url.href : '';
        } catch {
            return '';
        }
    }

    return hasUsableUrlHost({ hostname: getCandidateHostname(candidate) }) ? candidate : '';
}

export function isLinkText(value) {
    return !!getLinkUrl(value);
}

export function splitLinks(text) {
    const value = String(text ?? '');
    const parts = [];
    let index = 0;
    let match;

    while ((match = LINK_PATTERN.exec(value))) {
        const raw = match[0];
        if (!canStartLink(value, match.index)) {
            continue;
        }

        const cleanRaw = raw.replace(LINK_TRAILING_PUNCT, '');
        const url = getLinkUrl(cleanRaw);
        if (!url) {
            continue;
        }

        const end = match.index + raw.length;
        const cleanEnd = match.index + cleanRaw.length;
        if (match.index > index) {
            parts.push({ t: 'txt', c: value.slice(index, match.index) });
        }
        parts.push({ t: 'lnk', c: value.slice(match.index, cleanEnd), u: url });
        if (cleanEnd < end) {
            parts.push({ t: 'txt', c: value.slice(cleanEnd, end) });
        }
        index = end;
    }

    if (index < value.length) {
        parts.push({ t: 'txt', c: value.slice(index) });
    }

    return parts.length ? parts : [{ t: 'txt', c: value }];
}

export function isLongTxt(msg) {
    return msg?.t === 'txt' && typeof msg.c === 'string' && charLength(msg.c) > MAX_TXT_CHARS;
}

export function makeTxtFileName(text) {
    const first =
        cleanText(text)
            .split(/\s+/)[0] || 'message';
    const clean = first.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim();
    const base = Array.from(clean).slice(0, 12).join('');
    return `${base || 'message'}.txt`;
}

export function makeTxt(text) {
    const c = cleanText(text);
    if (!c) {
        throw new Error('text required');
    }
    return { t: 'txt', c };
}

export function setTxt(msg, text) {
    const c = cleanText(text);
    if (!c) {
        throw new Error('text required');
    }
    return {
        ...(typeof msg?.s === 'string' && msg.s ? { s: msg.s } : {}),
        ...(typeof msg?.cid === 'string' && msg.cid ? { cid: msg.cid } : {}),
        ...(typeof msg?.r === 'string' && msg.r ? { r: msg.r } : {}),
        ...retentionPatch(msg),
        t: 'txt',
        c,
    };
}
