import { origins } from './links.js';
import { getRouteParam } from './navigation/params.js';
import { slogan } from './product.js';
import { qr, readQr } from './qr.js';
import { isUsername, normalizeUsername } from './username.js';
import { cleanText, lowerText } from './utils/text.js';

export const invite = Object.freeze({
    join: 'join',
    chat: 'chat',
    send: 'send',
    request: 'request',
    media: 'media',
});

const inviteKinds = new Set(Object.values(invite));
const tokenKinds = new Map([
    ['chat', invite.chat],
    ['send', invite.send],
    ['pay', invite.request],
    ['media', invite.media],
]);

function getInviteOrigin() {
    return origins.veyl;
}

function maybe(value) {
    const next = cleanText(value);
    return next || null;
}

function cleanUsername(value) {
    const next = maybe(value);
    if (!next) return null;

    const raw = next.startsWith('@') ? next.slice(1) : next;
    const username = normalizeUsername(raw);
    return isUsername(username) ? username : null;
}

function cleanKind(value) {
    const kind = lowerText(value);
    return inviteKinds.has(kind) ? kind : null;
}

function cleanCurrency(value) {
    const currency = lowerText(value);
    return ['sats', 'btc', 'usd'].includes(currency) ? currency : null;
}

function cleanAmount(value) {
    const amount = maybe(value);
    return amount && /^\d+(\.\d+)?$/.test(amount) ? amount : null;
}

function publicUser(username) {
    return username ? `@${username}` : 'someone';
}

function amountFromToken(value) {
    const raw = lowerText(value);
    const match = raw.match(/^(\d+(?:\.\d+)?)$/);
    if (!match) return {};
    return {
        amount: match[1],
    };
}

function cleanInviteData(value = {}) {
    const kind = cleanKind(value.kind ?? value.type);
    if (!kind) return null;

    return {
        kind,
        from: cleanUsername(value.from ?? value.sender),
        to: cleanUsername(value.to ?? value.recipient),
        amount: cleanAmount(value.a ?? value.amount),
        currency: cleanCurrency(value.c ?? value.currency),
        walletPK: maybe(value.r ?? value.walletPK),
        source: maybe(value.src ?? value.source),
    };
}

function queryValue(value) {
    return Array.isArray(value) ? value[0] : value;
}

function queryEntries(params) {
    if (!params) return [];
    if (typeof params.entries === 'function') return Array.from(params.entries());
    if (typeof params === 'object') return Object.entries(params);
    return [];
}

function tokenInvite(token, params) {
    const parts = cleanText(token)
        .split('/')
        .filter(Boolean)
        .map((part) => {
            try {
                return decodeURIComponent(part);
            } catch {
                return part;
            }
        });
    if (!parts.length) return null;
    if (lowerText(parts[0]) !== invite.join) return null;

    const from = cleanUsername(parts[1]);
    const actionIndex = from ? 2 : 1;
    const action = lowerText(parts[actionIndex]);
    const kind = tokenKinds.get(action) || invite.join;
    const tokenAmount = amountFromToken(parts[actionIndex + 1]);

    return cleanInviteData({
        kind,
        from,
        amount: getRouteParam(params, 'a') ?? getRouteParam(params, 'amount') ?? tokenAmount.amount,
        currency: getRouteParam(params, 'c') ?? getRouteParam(params, 'currency') ?? tokenAmount.currency,
        walletPK: getRouteParam(params, 'r') ?? getRouteParam(params, 'walletPK'),
        source: getRouteParam(params, 'src') ?? getRouteParam(params, 'source'),
    });
}

function compactInvite(params) {
    for (const [key, value] of queryEntries(params)) {
        if (cleanText(queryValue(value))) continue;
        const data = tokenInvite(key, params);
        if (data) return data;
    }
    return null;
}

function inviteToken(data) {
    const from = cleanUsername(data.from);
    const user = from ? `@${from}` : '';
    const amount = cleanAmount(data.amount);

    if (data.kind === invite.join) return ['join', user].filter(Boolean).join('/');
    if (data.kind === invite.chat) return ['join', user, 'chat'].filter(Boolean).join('/');
    if (data.kind === invite.send) return ['join', user, 'send', amount].filter(Boolean).join('/');
    if (data.kind === invite.request) return ['join', user, 'pay', amount].filter(Boolean).join('/');
    if (data.kind === invite.media) return ['join', user, 'media'].filter(Boolean).join('/');
    return 'join';
}

function parseUrl(value) {
    try {
        return new URL(value, getInviteOrigin());
    } catch {
        return null;
    }
}

function readParams(params) {
    const compact = compactInvite(params);
    if (compact) return compact;

    const explicitKind = getRouteParam(params, 'kind') ?? getRouteParam(params, 'k');
    const cleanedKind = cleanKind(explicitKind);
    const from = cleanUsername(getRouteParam(params, 'from') ?? getRouteParam(params, 'f'));
    const hasIntent = !!explicitKind || !!from;
    if (!hasIntent) return null;
    if (explicitKind && !cleanedKind) return null;

    const kind = cleanedKind || (from ? invite.chat : invite.join);

    return cleanInviteData({
        kind,
        from,
        to: cleanUsername(getRouteParam(params, 'to')),
        amount: cleanAmount(getRouteParam(params, 'a') ?? getRouteParam(params, 'amount')),
        currency: cleanCurrency(getRouteParam(params, 'c') ?? getRouteParam(params, 'currency')),
        walletPK: maybe(getRouteParam(params, 'r') ?? getRouteParam(params, 'walletPK')),
        source: maybe(getRouteParam(params, 'src') ?? getRouteParam(params, 'source')),
    });
}

function makeQuery(params) {
    return Object.entries(params)
        .map(([key, value]) => {
            const next = maybe(value);
            return next ? `${encodeURIComponent(key)}=${encodeURIComponent(next)}` : null;
        })
        .filter(Boolean)
        .join('&');
}

export function makeInvite(value = {}) {
    const kind = value.kind ?? value.type;
    const cleanedKind = cleanKind(kind);
    const rawTo = value.to ?? value.recipient;
    const toIsUsername = !!cleanUsername(rawTo);
    const paymentKind = cleanedKind === invite.send || cleanedKind === invite.request;
    const receiver = value.r ?? value.walletPK ?? value.receiver ?? (paymentKind && !toIsUsername ? rawTo : null);
    const data = readParams({
        kind,
        from: value.from ?? value.sender,
        to: rawTo,
        a: value.a ?? value.amount,
        c: value.c ?? value.currency,
        r: receiver,
        src: value.src ?? value.source,
    });
    if (!data) return null;

    return {
        kind: data.kind,
        ...(data.from ? { from: data.from } : {}),
        ...(data.to ? { to: data.to } : {}),
        ...(data.amount ? { amount: data.amount } : {}),
        ...(data.currency ? { currency: data.currency } : {}),
        ...(data.walletPK ? { walletPK: data.walletPK } : {}),
        ...(data.source ? { source: data.source } : {}),
    };
}

export function makeInviteLink(value = {}) {
    const data = makeInvite(value);
    if (!data) return null;

    const token = inviteToken(data);
    const query = makeQuery({
        to: data.to,
        r: data.walletPK,
        src: data.source,
    });

    return `${getInviteOrigin()}/?${[token, query].filter(Boolean).join('&')}`;
}

export function inviteFromQr(raw) {
    const data = raw?.kind ? raw : readQr(raw);
    if (data?.kind === qr.user && data.username) {
        return makeInvite({ kind: invite.chat, from: data.username, source: 'qr' });
    }
    if (data?.kind === qr.request && data.to) {
        return makeInvite({ kind: invite.request, walletPK: data.to, amount: data.amount, currency: data.currency || 'sats', source: 'qr' });
    }
    return null;
}

export function makeInviteLinkFromQr(raw) {
    const data = inviteFromQr(raw);
    return data ? makeInviteLink(data) : null;
}

export function readInvite(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return readParams(raw);

    const value = cleanText(raw);
    if (!value) return null;

    const url = parseUrl(value);
    if (!url || url.pathname !== '/') return null;
    return readParams(url.searchParams);
}

export function readInviteOrQr(raw) {
    return readInvite(raw) || inviteFromQr(raw);
}

function grouped(value) {
    const amount = cleanAmount(value);
    if (!amount) return '';

    const [whole, decimal] = amount.split('.');
    const body = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decimal ? `${body}.${decimal}` : body;
}

function amountLabel(data) {
    if (!data?.amount) return '';
    if (data.currency === 'usd') return `$${grouped(data.amount)}`;
    if (data.currency === 'btc') return `${grouped(data.amount)} BTC`;
    const amount = grouped(data.amount);
    return `${amount} ${amount === '1' ? 'sat' : 'sats'}`;
}

export const inviteText = Object.freeze({
    body: slogan,
    hook: 'Open veyl.',
    action: Object.freeze({
        join: 'Join veyl',
        chat: 'Chat on veyl',
        send: 'Open veyl',
        request: 'Pay on veyl',
        media: 'Open veyl',
    }),
});

function inviteCopy(data) {
    const from = publicUser(data.from);
    const amount = amountLabel(data);

    if (data.kind === invite.chat) {
        return { title: `${from} wants to chat with you on veyl`, action: inviteText.action.chat };
    }
    if (data.kind === invite.send) {
        return { title: amount ? `${from} wants to send you ${amount} on veyl` : `${from} wants to send you sats on veyl`, action: inviteText.action.send };
    }
    if (data.kind === invite.request) {
        if (data.from && amount) return { title: `pay ${from} ${amount} on veyl`, action: inviteText.action.request };
        return { title: data.from ? `pay ${from} on veyl` : amount ? `pay ${amount} on veyl` : 'pay on veyl', action: inviteText.action.request };
    }
    if (data.kind === invite.media) {
        return { title: `${from} shared private media on veyl`, action: inviteText.action.media };
    }
    if (data.kind === invite.join && data.from) {
        return { title: `${from} invited you to join veyl`, action: inviteText.action.join };
    }
    return { title: 'Join veyl', action: inviteText.action.join };
}

export function describeInvite(raw) {
    const data = readInviteOrQr(raw);
    if (!data) return null;

    const copy = inviteCopy(data);
    return {
        title: copy.title,
        body: copy.body || inviteText.body,
        hook: copy.hook || inviteText.hook,
        action: copy.action,
    };
}
