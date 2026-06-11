import { origins } from './links.js';
import { getRouteParam } from './navigation/params.js';
import { qr, readQr } from './qr.js';
import { isUsername, normalizeUsername } from './username.js';
import { cleanText, lowerText } from './utils/text.js';

export const invite = Object.freeze({
    join: 'join',
    chat: 'chat',
    send: 'send',
    request: 'request',
    media: 'media',
    faucetDemo: 'faucet-demo',
});

const inviteKinds = new Set(Object.values(invite));

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

function parseUrl(value) {
    try {
        return new URL(value, getInviteOrigin());
    } catch {
        return null;
    }
}

function readParams(params) {
    const explicitKind = getRouteParam(params, 'kind') ?? getRouteParam(params, 'k');
    const cleanedKind = cleanKind(explicitKind);
    const from = cleanUsername(getRouteParam(params, 'from') ?? getRouteParam(params, 'f'));
    const marker = getRouteParam(params, 'invite') === '1';
    const hasIntent = marker || !!explicitKind || !!from;
    if (!hasIntent) return null;
    if (explicitKind && !cleanedKind) return null;

    const kind = cleanedKind || (from ? invite.chat : invite.join);

    if (!kind) return null;

    return {
        kind,
        from,
        to: cleanUsername(getRouteParam(params, 'to')),
        amount: cleanAmount(getRouteParam(params, 'a') ?? getRouteParam(params, 'amount')),
        currency: cleanCurrency(getRouteParam(params, 'c') ?? getRouteParam(params, 'currency')),
        walletPK: maybe(getRouteParam(params, 'r') ?? getRouteParam(params, 'walletPK')),
        source: maybe(getRouteParam(params, 'src') ?? getRouteParam(params, 'source')),
    };
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

    const query = makeQuery({
        invite: data.kind === invite.join ? '1' : null,
        kind: data.kind === invite.join ? null : data.kind,
        from: data.from,
        to: data.to,
        a: data.amount,
        c: data.currency,
        r: data.walletPK,
        src: data.source,
    });

    return `${getInviteOrigin()}/${query ? `?${query}` : ''}`;
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
    if (typeof raw === 'object') return makeInvite(raw);

    const value = cleanText(raw);
    if (!value) return null;

    const url = parseUrl(value);
    if (!url || url.pathname !== '/') return null;
    return readParams(url.searchParams);
}

export function readInviteOrQr(raw) {
    return readInvite(raw) || inviteFromQr(raw);
}

function displayUser(username) {
    return username ? `@${username}` : 'someone';
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

export function describeInvite(raw) {
    const data = readInviteOrQr(raw);
    if (!data) return null;

    const from = displayUser(data.from);
    const amount = amountLabel(data);
    const body = 'Veyl is private chat with Bitcoin payments built in.';
    const hook = 'Send sats inside private chat.';

    if (data.kind === invite.chat) {
        return { title: `${from} wants to chat privately with you on Veyl`, body, hook, action: 'Continue to private chat' };
    }
    if (data.kind === invite.send) {
        return { title: amount ? `${from} wants to send you ${amount} on Veyl` : `${from} wants to send you sats on Veyl`, body, hook, action: 'Open in Veyl' };
    }
    if (data.kind === invite.request) {
        return { title: amount ? `${from} requested ${amount} on Veyl` : `${from} sent you a payment request on Veyl`, body, hook, action: 'Pay with Veyl' };
    }
    if (data.kind === invite.media) {
        return { title: `${from} shared private media on Veyl`, body, hook, action: 'Continue to private chat' };
    }
    if (data.kind === invite.faucetDemo) {
        return {
            title: 'Try Veyl with @faucet',
            body: 'Send a tiny request to @faucet and see private chat plus Bitcoin settlement in one flow. Limited demo budget.',
            hook,
            action: 'Try Veyl',
        };
    }

    return { title: 'Create a private Veyl account', body, hook, action: 'Create account' };
}
